import type { ReactNode } from 'react';

type FormSectionProps = {
  label?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export function FormSection({
  label,
  title,
  description,
  children,
}: FormSectionProps) {
  return (
    <section className="modal-section">
      <div className="modal-section-header">
        {label ? <p className="section-label">{label}</p> : null}
        <h3 className="modal-section-title">{title}</h3>
        {description ? (
          <p className="modal-section-description">{description}</p>
        ) : null}
      </div>
      <div className="modal-section-body">{children}</div>
    </section>
  );
}
