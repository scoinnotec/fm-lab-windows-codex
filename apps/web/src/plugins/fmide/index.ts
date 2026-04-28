import type { PluginModule } from '../types';
import { FmideOpenButton } from './components/FmideOpenButton';
import { FmideQuickAction } from './components/FmideQuickAction';
import './styles.css';

const fmide: PluginModule = {
  name: 'fmide',
  slots: {
    objectHeaderActions: FmideOpenButton,
    objectListItemActions: FmideQuickAction,
  },
};

export default fmide;
