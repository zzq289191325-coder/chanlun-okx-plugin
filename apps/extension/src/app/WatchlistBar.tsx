import { Link2, Plus, X } from "lucide-react";
import type { ChanlunSettings } from "@/store/useChanlunStore";

interface WatchlistBarProps {
  instId: string;
  symbolMode: ChanlunSettings["symbolMode"];
  watchlist: string[];
  onSelect: (instId: string) => void;
  onAddCurrent: () => void;
  onRemove: (instId: string) => void;
  onFollowPage: () => void;
}

export function WatchlistBar({
  instId,
  symbolMode,
  watchlist,
  onSelect,
  onAddCurrent,
  onRemove,
  onFollowPage,
}: WatchlistBarProps) {
  return (
    <div className="cv-watchlist" aria-label="自选品种">
      <div className="cv-watchlist-head">
        <button
          type="button"
          className={`cv-watchlist-mode ${symbolMode === "page" ? "is-active" : ""}`}
          onClick={onFollowPage}
          title="跟随 OKX 主图"
        >
          <Link2 size={13} />
          <span>主图</span>
        </button>
        <button
          type="button"
          className="cv-watchlist-icon-btn"
          onClick={onAddCurrent}
          disabled={!instId}
          title="加入当前品种"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="cv-watchlist-items">
        {watchlist.length > 0 ? (
          watchlist.map((item) => (
            <span key={item} className={`cv-watchlist-chip ${item === instId ? "is-active" : ""}`}>
              <button type="button" onClick={() => onSelect(item)} title={`切换到 ${item}`}>
                {item}
              </button>
              <button
                type="button"
                className="cv-watchlist-remove"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(item);
                }}
                title={`移除 ${item}`}
              >
                <X size={11} />
              </button>
            </span>
          ))
        ) : (
          <span className="cv-watchlist-empty">暂无自选</span>
        )}
      </div>
    </div>
  );
}
