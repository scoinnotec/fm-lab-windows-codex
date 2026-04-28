import React from 'react';
import { useFmideUri } from '../hooks/useFmideUri';
import type { ObjectSlotProps } from '../../types';

/**
 * "In FileMaker öffnen"-Button im Object-Header.
 * Fetcht die fmp:// URL über die REST-API und rendert nur, wenn das
 * Backend den Object_Type unterstützt.
 */
export const FmideOpenButton: React.FC<ObjectSlotProps> = ({ objectUuid }) => {
  const { data } = useFmideUri(objectUuid);

  if (!data?.supported || !data.fmp_url) return null;

  const handleClick = () => {
    if (data.fmp_url) {
      window.location.href = data.fmp_url;
    }
  };

  return (
    <button
      onClick={handleClick}
      className="fmide-open-button"
      aria-label="In FileMaker öffnen"
      title={data.thingamajig_uri || 'In FileMaker öffnen'}
    >
      <span className="fmide-unicorn" aria-hidden="true">&#x1F984;</span>
      <span>In FileMaker öffnen</span>
    </button>
  );
};
