// RiuPlay: the media API as the backend exposes it (shared/media.ts MediaApi), minus the parts that
// need the operating system (native file picker, reading folders), which main/ipc/media.ts adds.
import type { MediaApi } from "@shared/media";
import { addToCollection, collectionItemsOf, collectionsOf, createCollection, listCollections, removeCollection, removeFromCollection, updateCollection } from "./collections";
import { addMedia, addUnit, continueList, getMedia, listMedia, recentlyAdded, removeMedia, removeUnit, saveProgress, setFavorite, setLibrary, setUnitCompleted, updateMedia } from "./media";

export type CoreMediaApi = Omit<MediaApi, "addFiles" | "pickFiles">;

export function createMediaApi(): CoreMediaApi {
  return {
    list: (filter) => listMedia(filter),
    get: (id) => getMedia(id),
    add: (input) => addMedia(input),
    update: (id, patch) => updateMedia(id, patch),
    remove: (id) => removeMedia(id),
    addUnit: (mediaId, unit) => addUnit(mediaId, unit),
    removeUnit: (unitId) => removeUnit(unitId),
    setLibrary: (mediaId, state) => setLibrary(mediaId, state),
    setFavorite: (mediaId, favorite) => setFavorite(mediaId, favorite),
    saveProgress: (unitId, position, duration) => saveProgress(unitId, position, duration),
    setUnitCompleted: (unitId, completed) => setUnitCompleted(unitId, completed),
    continueList: (type, limit) => continueList(type, limit),
    recentlyAdded: (limit) => recentlyAdded(limit),
    collections: {
      list: () => listCollections(),
      create: (name, description) => createCollection(name, description),
      update: (id, patch) => updateCollection(id, patch),
      remove: (id) => removeCollection(id),
      items: (id) => collectionItemsOf(id),
      addItem: (id, ref) => addToCollection(id, ref),
      removeItem: (id, ref) => removeFromCollection(id, ref),
      of: (ref) => collectionsOf(ref),
    },
  };
}
