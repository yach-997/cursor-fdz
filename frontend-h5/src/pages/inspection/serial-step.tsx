import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Button, Field, Toast } from 'react-vant';
import {
  ocrUnitDeviceSerial,
  saveUnitDeviceSerial,
  uploadFinanceWorkPhoto,
} from '../../api/finance';
import { displayPhotoUrl } from '../../utils/photo-url';
import { compressImage } from '../../utils/imageCompress';

type Props = {
  caseId: string;
  unitId: string;
  unitSeq?: number;
  initialSerial?: string | null;
  initialPhotoUrl?: string | null;
  readonly?: boolean;
  onPreview?: (urls: string[], index: number) => void;
};

export type SerialStepHandle = {
  /** 校验并落库；成功返回序列号，失败返回 null */
  confirmAndSave: () => Promise<{ serial: string; photoUrl?: string | null } | null>;
};

/** 分台作业：拍照识别设备序列号（可手改；点底部「下一步」保存并继续） */
export const SerialStepPanel = forwardRef<SerialStepHandle, Props>(function SerialStepPanel(
  { caseId, unitId, unitSeq, initialSerial, initialPhotoUrl, readonly, onPreview },
  ref,
) {
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl || '');
  const [serial, setSerial] = useState(initialSerial || '');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  const runOcr = async (url: string) => {
    setOcrBusy(true);
    try {
      const res = await ocrUnitDeviceSerial(caseId, unitId, url);
      if (res.serial) {
        setSerial(res.serial);
        Toast.success(`识别到 ${res.serial}`);
      } else {
        Toast.info('未识别到序列号，请手填或换张更清晰的铭牌图');
      }
    } catch {
      Toast.info('识别失败，请手填序列号');
    } finally {
      setOcrBusy(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || readonly) return;
    setUpBusy(true);
    try {
      const file = files[0];
      const compressed = await compressImage(file);
      const uploaded = await uploadFinanceWorkPhoto(caseId, compressed);
      const url = uploaded.url;
      setPhotoUrl(url);
      await runOcr(url);
    } catch {
      Toast.fail('上传失败');
    } finally {
      setUpBusy(false);
      if (camRef.current) camRef.current.value = '';
      if (galRef.current) galRef.current.value = '';
    }
  };

  useImperativeHandle(ref, () => ({
    confirmAndSave: async () => {
      const value = serial.trim().replace(/\s+/g, '').toUpperCase();
      if (value.length < 4) {
        Toast.fail('请填写至少 4 位的设备序列号');
        return null;
      }
      try {
        const saved = await saveUnitDeviceSerial(caseId, unitId, {
          deviceSerial: value,
          serialPhotoUrl: photoUrl || undefined,
        });
        return {
          serial: saved.deviceSerial,
          photoUrl: saved.serialPhotoUrl,
        };
      } catch {
        return null;
      }
    },
  }));

  return (
    <div className="trip-wizard-card">
      <h3>识别设备序列号{unitSeq ? ` · 台 #${unitSeq}` : ''}</h3>
      <p>拍摄设备铭牌或机身序列号，识别不对可手改，点下方「下一步」保存并进入检查项。</p>

      <div className="trip-wizard-block">
        <strong>铭牌 / 序列号照片</strong>
        <div className="inspection-photo-grid serial-photo-grid">
          {photoUrl ? (
            <div className="inspection-photo-thumb trip-inline-thumb">
              <button
                type="button"
                className="trip-inline-thumb-btn"
                onClick={() => onPreview?.([photoUrl], 0)}
              >
                <img src={displayPhotoUrl(photoUrl)} alt="序列号" />
              </button>
              {!readonly && (
                <button
                  type="button"
                  className="inspection-photo-remove"
                  onClick={() => {
                    setPhotoUrl('');
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ) : (
            <div className="inspection-photo-placeholder">
              <strong>＋</strong>
              <span>拍铭牌</span>
            </div>
          )}
        </div>
        {!readonly && (
          <div className="trip-slot-actions">
            <input
              ref={galRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => void onFiles(e.target.files)}
            />
            <input
              ref={camRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button
              round
              size="small"
              loading={upBusy || ocrBusy}
              disabled={upBusy || ocrBusy}
              onClick={() => galRef.current?.click()}
            >
              相册
            </Button>
            <Button
              type="primary"
              round
              size="small"
              loading={upBusy || ocrBusy}
              disabled={upBusy || ocrBusy}
              onClick={() => camRef.current?.click()}
            >
              拍照
            </Button>
            {photoUrl ? (
              <Button
                round
                size="small"
                loading={ocrBusy}
                disabled={ocrBusy}
                onClick={() => void runOcr(photoUrl)}
              >
                重新识别
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="trip-wizard-block">
        <strong>设备序列号</strong>
        <Field
          value={serial}
          readOnly={readonly}
          placeholder="识别结果可手改"
          onChange={setSerial}
        />
      </div>
    </div>
  );
});
