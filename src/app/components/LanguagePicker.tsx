import { Languages } from 'lucide-react';
import type { ContentLanguage, LanguageCode } from '../../domain';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface LanguagePickerProps {
  readonly languages: readonly ContentLanguage[];
  readonly value: LanguageCode;
  readonly onChange: (language: ContentLanguage) => void;
}

/** Chooses the language every collection in the view is read in. */
export function LanguagePicker({ languages, value, onChange }: LanguagePickerProps) {
  return (
    <Select
      items={languages.map((language) => ({ label: language.name, value: language.code }))}
      value={value}
      onValueChange={(code) => {
        const language = languages.find((entry) => entry.code === code);
        if (language) onChange(language);
      }}
    >
      <SelectTrigger size="sm" aria-label="Content language">
        <Languages size={13} aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {languages.map((language) => (
          <SelectItem key={language.code} value={language.code} label={language.name}>
            {language.name}
            <span className="text-muted-foreground ml-2 text-xs">{language.code}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
