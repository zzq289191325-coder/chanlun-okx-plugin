import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { normalizeInstIdList } from "@/okx/symbolResolver";
import type { ChanlunSettings } from "@/store/useChanlunStore";

interface SettingsModalProps {
  settings: ChanlunSettings;
  onClose: () => void;
  onSave: (settings: Partial<ChanlunSettings>) => void;
}

export function SettingsModal({ settings, onClose, onSave }: SettingsModalProps) {
  const [watchlistDraft, setWatchlistDraft] = useState(settings.watchlist.join("\n"));

  useEffect(() => {
    setWatchlistDraft(settings.watchlist.join("\n"));
  }, [settings.watchlist]);

  const applyWatchlist = () => {
    const watchlist = normalizeInstIdList(watchlistDraft);
    setWatchlistDraft(watchlist.join("\n"));
    onSave({ watchlist });
  };

  return (
    <div className="cv-modal-backdrop" role="dialog" aria-modal="true">
      <div className="cv-modal">
        <div className="cv-modal-head">
          <h2>设置</h2>
          <button type="button" className="cv-icon-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <label className="cv-field">
          <span>交易对</span>
          <input
            value={settings.instId}
            onChange={(event) => onSave({ instId: event.target.value.toUpperCase() })}
            placeholder="BTC-USDT-SWAP"
            spellCheck={false}
          />
        </label>
        <label className="cv-check">
          <input
            type="checkbox"
            checked={settings.realtime}
            onChange={(event) => onSave({ realtime: event.target.checked })}
          />
          <span>启用实时 K 线</span>
        </label>
        <label className="cv-field">
          <span>自选品种</span>
          <textarea
            value={watchlistDraft}
            onChange={(event) => setWatchlistDraft(event.target.value)}
            onBlur={applyWatchlist}
            spellCheck={false}
            rows={5}
            placeholder={"BTC-USDT-SWAP\nETH-USDT-SWAP"}
          />
        </label>
        <p className="cv-risk-note">本插件仅展示结构识别结果，不读取 API Key，不执行交易。</p>
      </div>
    </div>
  );
}
