import React from 'react';
import { ObjectDetail } from './ObjectDetail';

interface TypeDetailProps {
  objectType: string;
  uuid: string;
}

/**
 * Type Detail Router
 * Delegates to ObjectDetail which fetches type-specific details
 * via the /api/get-details endpoint (automatic template dispatch).
 */
export const TypeDetail: React.FC<TypeDetailProps> = ({ objectType, uuid }) => {
  return <ObjectDetail uuid={uuid} objectType={objectType} />;
};
