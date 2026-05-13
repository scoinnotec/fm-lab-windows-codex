import { useTheme } from '../hooks/useTheme';

export type GraphPalette = {
  boxBody: string;
  boxStroke: string;
  headerTextDefault: string;
  headerNeutral: string;
  fieldText: string;
  fieldHighlightBg: string;
  baseTableLabel: string;
  baseTableLabelDimmed: string;
  dimmedHeader: string;
  dimmedStroke: string;
  dimmedHeaderText: string;
  dimmedFieldText: string;
  dimmedFieldBg: string;
  selectionRing: string;
  highlightRing: string;
  joinStroke: string;
  joinOperatorBg: string;
  joinOperatorText: string;
  joinDimStroke: string;
  joinDimText: string;
  cascadeCreate: string;
  cascadeDelete: string;
  cascadeCreateDim: string;
  cascadeDeleteDim: string;
};

const PALETTES: Record<'light' | 'dark', GraphPalette> = {
  light: {
    boxBody: '#ffffff',
    boxStroke: '#222222',
    headerTextDefault: '#ffffff',
    headerNeutral: '#777777',
    fieldText: '#222222',
    fieldHighlightBg: '#fff7d6',
    baseTableLabel: '#666666',
    baseTableLabelDimmed: '#aaaaaa',
    dimmedHeader: '#bbbbbb',
    dimmedStroke: '#bbbbbb',
    dimmedHeaderText: '#666666',
    dimmedFieldText: '#999999',
    dimmedFieldBg: '#f5f5f5',
    selectionRing: '#dc2626',
    highlightRing: '#fb923c',
    joinStroke: '#444444',
    joinOperatorBg: '#ffffff',
    joinOperatorText: '#222222',
    joinDimStroke: '#cccccc',
    joinDimText: '#999999',
    cascadeCreate: '#0a7a0a',
    cascadeDelete: '#a30000',
    cascadeCreateDim: '#a8c7a8',
    cascadeDeleteDim: '#d4a8a8',
  },
  dark: {
    boxBody: '#1f242d',
    boxStroke: '#7c8493',
    headerTextDefault: '#0f1115',
    headerNeutral: '#54606f',
    fieldText: '#d8dce4',
    fieldHighlightBg: '#3a3520',
    baseTableLabel: '#9aa0aa',
    baseTableLabelDimmed: '#5e636d',
    dimmedHeader: '#3c4049',
    dimmedStroke: '#3c4049',
    dimmedHeaderText: '#7c818c',
    dimmedFieldText: '#5e636d',
    dimmedFieldBg: '#191c22',
    selectionRing: '#ff5a5a',
    highlightRing: '#ffa552',
    joinStroke: '#9ba2b0',
    joinOperatorBg: '#1f242d',
    joinOperatorText: '#d8dce4',
    joinDimStroke: '#3c4049',
    joinDimText: '#5e636d',
    cascadeCreate: '#5cd17a',
    cascadeDelete: '#ff7676',
    cascadeCreateDim: '#3e6a4a',
    cascadeDeleteDim: '#6a3e3e',
  },
};

export function useGraphPalette(): GraphPalette {
  const { theme } = useTheme();
  return PALETTES[theme];
}
