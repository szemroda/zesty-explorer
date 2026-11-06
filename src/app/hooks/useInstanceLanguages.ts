import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ContentLanguage, InstanceReference, LanguageCode } from '../../domain';
import type { CollectionApi } from '../../zesty-api';
import { runExplorerQuery } from './explorer-query';

interface InstanceLanguagesOptions {
  readonly api: CollectionApi;
  readonly instance: InstanceReference | undefined;
  readonly sessionToken: string;
  readonly enabled: boolean;
  /** The language the view names, or undefined for the instance's default language. */
  readonly chosen: LanguageCode | undefined;
}

export interface InstanceLanguages {
  /** The instance's active languages, default first; undefined while loading or after a failure. */
  readonly languages: readonly ContentLanguage[] | undefined;
  /** The language the view reads, or undefined while the default language is still unknown. */
  readonly language: LanguageCode | undefined;
}

// The Explorer read only en-US before languages could be chosen, so it still does when the
// instance's languages can't be read or none is active.
const fallbackLanguage = 'en-US';

/** Loads the instance's languages and resolves which one the view reads. */
export function useInstanceLanguages({
  api,
  instance,
  sessionToken,
  enabled,
  chosen,
}: InstanceLanguagesOptions): InstanceLanguages {
  const credentials = useMemo(
    () => ({ revision: crypto.randomUUID(), sessionToken }),
    [sessionToken],
  );
  const query = useQuery<readonly ContentLanguage[], Error>({
    queryKey: [
      'languages',
      credentials.revision,
      instance?.deployment ?? '',
      instance?.instanceZuid ?? '',
    ],
    enabled: enabled && Boolean(instance),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!instance || !credentials.sessionToken) {
        throw new Error('Language request is not ready.');
      }
      return runExplorerQuery(api.loadLanguages(instance, credentials.sessionToken), signal);
    },
  });

  const languages = query.data;
  if (chosen) return { languages, language: chosen };
  if (query.isError) return { languages, language: fallbackLanguage };
  if (!languages) return { languages, language: undefined };
  const defaultLanguage = languages.find((entry) => entry.isDefault) ?? languages[0];
  return { languages, language: defaultLanguage?.code ?? fallbackLanguage };
}
