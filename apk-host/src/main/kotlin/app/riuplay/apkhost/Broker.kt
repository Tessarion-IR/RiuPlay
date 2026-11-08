package app.riuplay.apkhost

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import java.net.SocketException
import java.net.SocketTimeoutException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import javax.net.SocketFactory

/**
 * RiuPlay: the only way the confined host talks to anything. The process runs in a Windows AppContainer
 * with no capabilities (riuplay-sandbox.exe): it can open no socket, so every byte it exchanges goes over
 * its stdin and stdout, as frames:
 *
 *   u32 length (of what follows) | u8 type | u32 channel | payload
 *
 * The application sends requests (REQ, answered by RES) and the host asks it for connections (OPEN host:port,
 * answered by OPENED or CLOSE). The application decides each connection - RiuPlay's network rules: public
 * addresses on the web ports only, resolved and pinned by the application - and relays the bytes (DATA).
 * TLS runs end to end inside the host, so the application sees host names and byte counts, never content.
 */
object Broker {
    const val READY = 0
    const val REQ = 1
    const val RES = 2
    const val OPEN = 10
    const val OPENED = 11
    const val DATA = 12
    const val CLOSE = 13
    const val EVENT = 20

    private const val MAX_FRAME = 8 * 1024 * 1024
    const val DATA_CHUNK = 64 * 1024

    /** True when the host runs confined and must reach the network through the application. */
    @Volatile var enabled = false
        private set

    private lateinit var out: DataOutputStream
    private val writeLock = Any()
    private val tunnels = ConcurrentHashMap<Int, TunnelSocket>()
    private val nextTunnel = AtomicInteger(1)

    fun start(input: InputStream, output: OutputStream, onRequest: (channel: Int, payload: ByteArray) -> Unit, onEnd: () -> Unit) {
        out = DataOutputStream(output.buffered(DATA_CHUNK + 16))
        enabled = true
        Thread({
            val data = DataInputStream(input.buffered(DATA_CHUNK + 16))
            try {
                while (true) {
                    val length = data.readInt()
                    if (length < 5 || length > MAX_FRAME) throw IOException("Bad frame length $length")
                    val type = data.readUnsignedByte()
                    val channel = data.readInt()
                    val payload = ByteArray(length - 5)
                    data.readFully(payload)
                    when (type) {
                        REQ -> onRequest(channel, payload)
                        OPENED -> tunnels[channel]?.opened()
                        DATA -> tunnels[channel]?.received(payload)
                        CLOSE -> tunnels[channel]?.closedByPeer(payload.decodeToString())
                    }
                }
            } catch (error: IOException) {
                // The application went away (or broke the protocol): nothing is left to serve.
                if (error !is java.io.EOFException) System.err.println("broker: input ended: $error")
            } finally {
                tunnels.values.forEach { it.closedByPeer("The application closed the connection") }
                onEnd()
            }
        }, "broker-reader").apply { isDaemon = false }.start()  // keeps the process alive until stdin closes
    }

    fun send(type: Int, channel: Int, payload: ByteArray, offset: Int = 0, length: Int = payload.size) = synchronized(writeLock) {
        out.writeInt(length + 5)
        out.writeByte(type)
        out.writeInt(channel)
        out.write(payload, offset, length)
        out.flush()
    }

    internal fun register(socket: TunnelSocket): Int {
        val id = nextTunnel.getAndIncrement()
        tunnels[id] = socket
        return id
    }

    internal fun unregister(id: Int) {
        tunnels.remove(id)
    }
}

/**
 * Host names stand for themselves: the application resolves them (and refuses private addresses). Each host
 * gets a distinct placeholder address from the reserved 240.0.0.0/4 block, so OkHttp's per-address
 * bookkeeping still tells hosts apart; the socket connects by name.
 */
object BrokerDns : okhttp3.Dns {
    private val placeholders = ConcurrentHashMap<String, InetAddress>()
    private val counter = AtomicInteger(0)

    override fun lookup(hostname: String): List<InetAddress> = listOf(
        placeholders.getOrPut(hostname.lowercase()) {
            val n = counter.incrementAndGet()
            InetAddress.getByAddress(hostname, byteArrayOf(240.toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte()))
        },
    )
}

object BrokerSocketFactory : SocketFactory() {
    override fun createSocket(): Socket = TunnelSocket()
    override fun createSocket(host: String, port: Int): Socket = TunnelSocket().apply { connect(InetSocketAddress.createUnresolved(host, port)) }
    override fun createSocket(host: String, port: Int, localHost: InetAddress?, localPort: Int): Socket = createSocket(host, port)
    override fun createSocket(host: InetAddress, port: Int): Socket = createSocket(host.hostName, port)
    override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress?, localPort: Int): Socket = createSocket(address.hostName, port)
}

/** A connection the application opened on the host's behalf; its bytes travel as DATA frames. */
class TunnelSocket : Socket() {
    private var id = 0
    private var remote: InetSocketAddress? = null
    private val opening = CompletableFuture<Unit>()
    private val incoming = LinkedBlockingQueue<ByteArray>()
    private var buffered: ByteArray? = null
    private var bufferedAt = 0
    @Volatile private var peerClosed: String? = null
    @Volatile private var closed = false
    @Volatile private var inputShut = false
    @Volatile private var outputShut = false
    @Volatile private var timeoutMs = 0
    private var received = 0L

    override fun connect(endpoint: SocketAddress) = connect(endpoint, 0)

    override fun connect(endpoint: SocketAddress, timeout: Int) {
        val address = endpoint as? InetSocketAddress ?: throw SocketException("Unsupported address")
        if (closed) throw SocketException("Socket is closed")
        remote = address
        id = Broker.register(this)
        val request = org.json.JSONObject().put("host", address.hostString).put("port", address.port).toString().toByteArray()
        Broker.send(Broker.OPEN, id, request)
        try {
            opening.get(if (timeout > 0) timeout.toLong() else 60_000L, TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            close()
            throw SocketTimeoutException("Connect to ${address.hostString}:${address.port} timed out")
        } catch (error: java.util.concurrent.ExecutionException) {
            close()
            throw java.net.ConnectException(error.cause?.message ?: "Connection refused")
        }
    }

    internal fun opened() {
        opening.complete(Unit)
    }

    internal fun received(bytes: ByteArray) {
        received += bytes.size
        if (received > MAX_BUFFERED_BYTES && incoming.sumOf { it.size } > MAX_BUFFERED_BYTES) {
            closedByPeer("Too much unread data")
            return
        }
        if (bytes.isNotEmpty()) incoming.put(bytes)
    }

    internal fun closedByPeer(reason: String) {
        if (peerClosed == null) peerClosed = reason.ifEmpty { "closed" }
        if (!opening.isDone) opening.completeExceptionally(java.net.ConnectException(reason.ifEmpty { "Connection refused" }))
        incoming.put(EOF)
        Broker.unregister(id)
    }

    private val input = object : InputStream() {
        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            if (closed) throw SocketException("Socket closed")
            var chunk = buffered
            if (chunk == null || bufferedAt >= chunk.size) {
                val next = if (timeoutMs > 0) incoming.poll(timeoutMs.toLong(), TimeUnit.MILLISECONDS) ?: throw SocketTimeoutException("Read timed out")
                else incoming.take()
                if (next === EOF) {
                    incoming.put(EOF)
                    return -1
                }
                chunk = next
                buffered = next
                bufferedAt = 0
            }
            val n = minOf(len, chunk.size - bufferedAt)
            System.arraycopy(chunk, bufferedAt, b, off, n)
            bufferedAt += n
            return n
        }

        override fun available(): Int = (buffered?.let { it.size - bufferedAt } ?: 0).coerceAtLeast(0)

        override fun close() = this@TunnelSocket.close()
    }

    private val output = object : OutputStream() {
        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

        override fun write(b: ByteArray, off: Int, len: Int) {
            if (closed || outputShut) throw SocketException("Socket closed")
            peerClosed?.let { throw SocketException("Connection closed: $it") }
            var at = off
            val end = off + len
            while (at < end) {
                val n = minOf(Broker.DATA_CHUNK, end - at)
                Broker.send(Broker.DATA, id, b, at, n)
                at += n
            }
        }

        override fun close() = this@TunnelSocket.close()
    }

    override fun getInputStream(): InputStream {
        if (!isConnected) throw SocketException("Socket is not connected")
        return input
    }

    override fun getOutputStream(): OutputStream {
        if (!isConnected) throw SocketException("Socket is not connected")
        return output
    }

    override fun close() {
        if (closed) return
        closed = true
        if (id != 0 && peerClosed == null) runCatching { Broker.send(Broker.CLOSE, id, ByteArray(0)) }
        Broker.unregister(id)
        incoming.put(EOF)
    }

    override fun isConnected(): Boolean = opening.isDone && !opening.isCompletedExceptionally
    override fun isBound(): Boolean = isConnected
    override fun isClosed(): Boolean = closed
    override fun isInputShutdown(): Boolean = inputShut
    override fun isOutputShutdown(): Boolean = outputShut
    override fun shutdownInput() { inputShut = true }
    override fun shutdownOutput() { outputShut = true }
    override fun setSoTimeout(timeout: Int) { timeoutMs = timeout }
    override fun getSoTimeout(): Int = timeoutMs
    override fun getInetAddress(): InetAddress? = remote?.let { it.address ?: InetAddress.getByAddress(it.hostString, byteArrayOf(240.toByte(), 0, 0, 0)) }
    override fun getPort(): Int = remote?.port ?: 0
    override fun getLocalAddress(): InetAddress = InetAddress.getLoopbackAddress()
    override fun getLocalPort(): Int = 1
    override fun getRemoteSocketAddress(): SocketAddress? = remote
    override fun getLocalSocketAddress(): SocketAddress = InetSocketAddress(InetAddress.getLoopbackAddress(), 1)
    override fun setTcpNoDelay(on: Boolean) {}
    override fun getTcpNoDelay(): Boolean = true
    override fun setKeepAlive(on: Boolean) {}
    override fun getKeepAlive(): Boolean = false
    override fun setSoLinger(on: Boolean, linger: Int) {}
    override fun getSoLinger(): Int = -1
    override fun setReceiveBufferSize(size: Int) {}
    override fun getReceiveBufferSize(): Int = Broker.DATA_CHUNK
    override fun setSendBufferSize(size: Int) {}
    override fun getSendBufferSize(): Int = Broker.DATA_CHUNK
    override fun toString(): String = "TunnelSocket[$id ${remote?.hostString}:${remote?.port}]"

    private companion object {
        val EOF = ByteArray(0)
        const val MAX_BUFFERED_BYTES = 64L * 1024 * 1024
    }
}
