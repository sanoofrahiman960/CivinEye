import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { MAX_PHOTO_EDGE, PHOTO_QUALITY } from '../constants/config';

export interface LocalPhoto {
  uri: string;
  width: number;
  height: number;
}

/** Resize to at most MAX_PHOTO_EDGE on the longest side and re-encode as JPEG before upload. */
export async function compressPhoto(photo: LocalPhoto): Promise<LocalPhoto> {
  const context = ImageManipulator.manipulate(photo.uri);
  const longest = Math.max(photo.width, photo.height);
  if (longest > MAX_PHOTO_EDGE) {
    context.resize(photo.width >= photo.height ? { width: MAX_PHOTO_EDGE } : { height: MAX_PHOTO_EDGE });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG });
  return { uri: result.uri, width: result.width, height: result.height };
}
