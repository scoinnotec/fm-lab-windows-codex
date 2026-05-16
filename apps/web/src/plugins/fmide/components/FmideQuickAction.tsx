import React from 'react';
import { useFeaturesContext } from '../../../hooks/useFeatures';
import { currentText } from '../../../lib/uiLanguage';
import { buildGotoUrl } from '../hooks/useFmideUri';
import type { ObjectSlotProps } from '../../types';

/**
 * URIcorn-Quick-Action in Listeneinträgen. Rendert nur, wenn das Backend
 * den Objekttyp als unterstützt ausweist (`ui.supported_object_types`).
 */
export const FmideQuickAction: React.FC<ObjectSlotProps> = ({ objectUuid, objectType }) => {
  const { getUi } = useFeaturesContext();
  const supported = getUi('fmide')?.supported_object_types ?? [];
  const label = currentText('Öffnen', 'Open');
  const title = currentText('In FileMaker öffnen', 'Open in FileMaker');

  if (!supported.includes(objectType)) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.location.href = buildGotoUrl(objectUuid);
  };

  return (
    <button
      className="fmide-quick-action"
      onClick={handleClick}
      aria-label={title}
      title={title}
    >
      <span className="fmide-quick-action-icon" aria-hidden="true">&#x1F984;</span>
      <span className="fmide-quick-action-label">{label}</span>
    </button>
  );
};
