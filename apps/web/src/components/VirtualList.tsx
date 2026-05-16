import React, { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { VirtualListRow } from '../types';
import { ObjectListItem } from './ObjectListItem';
import { LoadingSpinner } from './LoadingSpinner';
import { formatUiCount as formatCount, tx, type UiLanguage } from '../lib/uiLanguage';

const ITEM_HEIGHT = 80;
const HEADER_HEIGHT = 44;

interface VirtualListProps {
  rows: VirtualListRow[];
  itemCount: number;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  totalCount: number | null;
  language?: UiLanguage;
  onItemClick?: (uuid: string) => void;
  onSendToAiChat?: (prompt: string) => void;
  onToggleGroup?: (groupKey: string) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

/**
 * Virtual List Component
 * Renders a virtualized list with infinite scrolling
 *
 * Features:
 * - Only renders visible items (performance optimization)
 * - Auto-loads more when scrolling near bottom
 * - Supports group headers when grouping is active
 * - Loading indicator at bottom
 */
export const VirtualList: React.FC<VirtualListProps> = ({
  rows,
  itemCount,
  isLoading,
  hasMore,
  onLoadMore,
  totalCount,
  language = 'de',
  onItemClick,
  onSendToAiChat,
  onToggleGroup,
  scrollContainerRef,
}) => {
  const internalRef = useRef<HTMLDivElement>(null);
  const parentRef = scrollContainerRef || internalRef;

  // Initialize virtualizer with dynamic row heights
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rows[index]._type === 'header' ? HEADER_HEIGHT : ITEM_HEIGHT,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Auto-load more when scrolled near bottom
  useEffect(() => {
    const [lastItem] = [...virtualItems].reverse();

    if (!lastItem) return;

    // Trigger load when within last 20 rows
    if (lastItem.index >= rows.length - 20 && hasMore && !isLoading) {
      onLoadMore();
    }
  }, [virtualItems, rows.length, hasMore, isLoading, onLoadMore]);

  return (
    <div
      ref={parentRef}
      className="virtual-list-container"
    >
      {/* Results count header */}
      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {totalCount === 1 ? tx(language, 'Objekt gefunden', 'object found') : tx(language, 'Objekte gefunden', 'objects found')}
          {itemCount < totalCount && (
            <span className="loaded-count">
              ({formatCount(itemCount, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      {/* Virtual list content */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index];
          return (
            <div
              key={row._type === 'header' ? `header-${row.groupKey}` : row.object.Object_UUID}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {row._type === 'header' ? (
                <div
                  className="group-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={row.isExpanded}
                  onClick={() => onToggleGroup?.(row.groupKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggleGroup?.(row.groupKey);
                    }
                  }}
                >
                  <span className="group-header-toggle">
                    {row.isExpanded ? '\u25BE' : '\u25B8'}
                  </span>
                  <span className="group-header-label">
                    {row.groupLabel}
                  </span>
                  <span className="group-header-count">
                    ({row.itemCount})
                  </span>
                </div>
              ) : (
                <ObjectListItem object={row.object} onClick={onItemClick} onSendToAiChat={onSendToAiChat} />
              )}
            </div>
          );
        })}
      </div>

      {/* Loading indicator at bottom */}
      {isLoading && <LoadingSpinner message={tx(language, 'Lade weitere Objekte...', 'Loading more objects...')} />}

      {/* No more results indicator */}
      {!hasMore && itemCount > 0 && (
        <div className="virtual-list-footer">
          {tx(language, 'Alle Objekte geladen', 'All objects loaded')}
        </div>
      )}

      {/* Empty state */}
      {itemCount === 0 && !isLoading && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine Objekte gefunden', 'No objects found')}
        </div>
      )}
    </div>
  );
};
