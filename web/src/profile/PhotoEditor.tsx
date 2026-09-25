import { useCallback, useEffect, useId, useState } from 'react';
import Cropper, { type Area, type Point } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { ErrorBanner } from '../components/ErrorBanner';
import { MAX_BYTES } from './constants';
import { cropToJpeg } from './cropImage';
import { useProfile } from './ProfileContext';

export function PhotoEditor() {
  const { t } = useTranslation();
  const { view, apply } = useProfile();
  const { photo } = view.profile;
  const inputId = useId();
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // The picked file lives in memory as a blob: URL until it is replaced or the editor closes.
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const onCropComplete = useCallback((_area: Area, pixels: Area) => setArea(pixels), []);

  const choose = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
      setError(new ApiError('FILE_TYPE_NOT_ALLOWED', file.type || 'unknown type'));
      return;
    }
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setSrc(URL.createObjectURL(file));
  };

  const save = async () => {
    if (!src || !area) return;
    setBusy(true);
    setError(null);
    try {
      const image = await cropToJpeg(src, area);
      if (image.size > MAX_BYTES.photo) throw new ApiError('FILE_TOO_LARGE', `${image.size} bytes`);
      apply(await api.uploadPhoto(image));
      setSrc(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!photo) return;
    setError(null);
    try { apply(await api.deleteFile(photo.id)); } catch (err) { setError(err); }
  };

  return (
    <div className="card">
      <h2>{t('profile.files.photoTitle')}</h2>
      {src ? (
        <>
          <div className="cropper">
            {/* disableAutomaticStylesInjection: the library otherwise injects a <style> tag at runtime, which our
                strict CSP (no style-src 'unsafe-inline') blocks; the same CSS is imported above instead, bundled
                same-origin. */}
            <Cropper image={src} crop={crop} zoom={zoom} aspect={3 / 4} onCropChange={setCrop} onZoomChange={setZoom}
              onCropComplete={onCropComplete} disableAutomaticStylesInjection />
          </div>
          <div className="field">
            <label htmlFor={`${inputId}-zoom`}>{t('profile.files.photoZoom')}</label>
            <input id={`${inputId}-zoom`} type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn" disabled={!area || busy} onClick={() => void save()}>{t('profile.files.photoSave')}</button>
            <button type="button" className="btn ghost" onClick={() => setSrc(null)}>{t('common.cancel')}</button>
          </div>
        </>
      ) : (
        <>
          {photo
            ? <img className="photo-preview" src={api.fileUrl(photo.id)} alt={t('profile.files.photoAlt')} />
            : <p className="muted">{t('profile.files.photoNone')}</p>}
          <div className="btn-row">
            <label className="btn ghost" htmlFor={inputId}>{t('profile.files.photoChoose')}</label>
            {photo ? <button type="button" className="btn ghost" onClick={() => void remove()}>{t('profile.files.photoDelete')}</button> : null}
          </div>
          <input id={inputId} type="file" accept="image/jpeg,image/png" className="visually-hidden"
            onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        </>
      )}
      {error ? <ErrorBanner error={error} /> : null}
    </div>
  );
}
