import { Field, FieldError } from '@shinsa/ui/components/field';
import { Textarea } from '@shinsa/ui/components/textarea';
import { isCancelKey, isSubmitKey } from '@/lib/keys.ts';

interface RuleFieldProps {
  text: string;
  error: string | null;
  label: string;
  placeholder: string;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RuleField({ text, error, label, placeholder, onChange, onCancel, onSubmit }: RuleFieldProps) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <Textarea
        autoFocus
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className='min-h-0 resize-none'
        onKeyDown={(event) => {
          if (isCancelKey(event)) onCancel();
          if (isSubmitKey(event)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
