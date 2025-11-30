import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { FormSection } from '../FormSection';
import { SoftButton } from '../SoftButton';

export function SettingsModal(){
  const { modals, closeModal, theme, setTheme } = useAppStore();
  const open = modals.settings;
  const nextTheme = theme === 'light' ? 'dark' : 'light';

  return (
    <ModalBase
      open={open}
      title="Settings"
      //subtitle="Tune MOPAY to your preferences."
      icon="⚙️"
      onClose={() => closeModal("settings")}
      size="md"
    >
      <div className="stack">
        <FormSection
          //label="Appearance"
      label="Appearance"
      title="Theme palette"
      description="Rakit stays legible in both palettes."
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
              <span className="text-lg">{nextTheme === 'dark' ? '🌙' : '☀️'}</span>
            </SoftButton>
          </div>
        </FormSection>

        <FormSection label="Session" title="Lock your console">
          <SoftButton
            variant="ghost"
            onClick={() => {
              sessionStorage.removeItem('pin-ok');
              useAppStore.getState().setPinSession(false);
              closeModal('settings');
            }}
          >
            Lock application
          </SoftButton>
        </FormSection>

        <div className="modal-footer-premium flex justify-end">
          <SoftButton variant="ghost" onClick={()=>closeModal('settings')}>Close</SoftButton>
        </div>
      </div>
    </ModalBase>
  );
}
