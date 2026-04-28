import React from 'react';
import { useFeaturesContext } from '../../../hooks/useFeatures';
import { buildGotoUrl } from '../hooks/useFmideUri';
import type { ObjectSlotProps } from '../../types';

/**
 * URIcorn-Quick-Action in Listeneinträgen. Rendert nur, wenn das Backend
 * den Objekttyp als unterstützt ausweist (`ui.supported_object_types`).
 */
export const FmideQuickAction: React.FC<ObjectSlotProps> = ({ objectUuid, objectType }) => {
  const { getUi } = useFeaturesContext();
  const supported = getUi('fmide')?.supported_object_types ?? [];

  if (!supported.includes(objectType)) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.location.href = buildGotoUrl(objectUuid);
  };

  return (
    <button
      className="fmide-quick-action"
      onClick={handleClick}
      aria-label="In FileMaker öffnen"
      title="In FileMaker öffnen"
    >
      <span aria-hidden="true">&#x1F984;</span>
    </button>
  );
};
