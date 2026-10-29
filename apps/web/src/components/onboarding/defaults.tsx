import type { OnboardingChoiceGroup } from '@shinsa/core';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { OptionList } from '@/components/onboarding/options.tsx';
import { resolvePickedChoices } from '@/lib/onboarding.ts';

export function OnboardingDefaults({
  groups,
  values,
  disabled,
  autoFocus,
  onChange,
}: {
  groups: OnboardingChoiceGroup[];
  values: string[];
  disabled: boolean;
  autoFocus: boolean;
  onChange: (values: string[]) => void;
}) {
  return (
    <div className='flex flex-col gap-4'>
      {groups.map((group, index) => (
        <div key={group.id} className='flex flex-col gap-1.5'>
          <SectionLabel>{group.label}</SectionLabel>
          <OptionList
            options={group.options}
            values={values}
            multiple={false}
            label={group.label}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
            onPick={(value) => onChange(resolvePickedChoices(group, values, value))}
          />
        </div>
      ))}
    </div>
  );
}
