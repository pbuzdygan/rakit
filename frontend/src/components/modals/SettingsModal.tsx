import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { FormSection } from '../FormSection';
import { SoftButton } from '../SoftButton';
import { OperationsIcon } from '../OperationsIcon';
import { Api } from '../../api';

export function SettingsModal(){
  const { modals, closeModal, theme, setTheme } = useAppStore();
  const open = modals.settings;
  const nextTheme = theme === 'light' ? 'dark' : 'light';

  return (
    <ModalBase
      open={open}
      title="Settings"
      eyebrow="System"
      //subtitle="Tune MOPAY to your preferences."
      onClose={() => closeModal("settings")}
      size="md"
    >
      <div className="stack">
        <FormSection
          label="Appearance"
          title="Theme palette"
        >
      <div className="flex flex-col gap-2">
        <p className="field-helper">
          Current: <span className="font-medium text-textPrim">{theme}</span>
            </p>
            <SoftButton
              block
              justify="between"
              onClick={()=> setTheme(nextTheme)}
            >
              Switch to {nextTheme}
              <OperationsIcon name="settings" className="h-4 w-4" />
            </SoftButton>
          </div>
        </FormSection>

        <FormSection label="Session" title="Lock your console">
          <SoftButton
            block
            justify="between"
            onClick={() => {
              void Api.session.logout().finally(() => {
                useAppStore.getState().setPinSession(false);
                closeModal('settings');
              });
            }}
          >
            Lock application
            <span className="text-lg">🔒</span>
          </SoftButton>
        </FormSection>

        <div className="modal-footer-premium flex justify-end">
          <SoftButton variant="ghost" onClick={()=>closeModal('settings')}>Close</SoftButton>
        </div>
      </div>
    </ModalBase>
  );
}
