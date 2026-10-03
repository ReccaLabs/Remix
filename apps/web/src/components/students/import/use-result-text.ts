import { IMPORT_FIELDS, type ImportRowResult } from '@remix/types/api';
import { useTranslations } from 'next-intl';

/**
 * One plain sentence per checked row: what is wrong with it, or whom it duplicates. Field
 * messages come from the API (English); the field name is localised here. Used on screen and in
 * the downloadable error file, so both say the same thing.
 */
export function useResultText(): (result: ImportRowResult) => string {
  const t = useTranslations('import.review');
  const tFields = useTranslations('import.map.fields');
  return (result) => {
    const parts: string[] = [];
    if (result.status === 'duplicate' && result.duplicateOf) {
      const { studentNo, rowNo } = result.duplicateOf;
      parts.push(
        studentNo
          ? t('duplicateOfStudent', { studentNo })
          : rowNo
            ? t('duplicateOfRow', { row: rowNo })
            : t('duplicateOfStudentAnon'),
      );
    }
    for (const error of result.errors) {
      const field = IMPORT_FIELDS.find((k) => k === error.field);
      parts.push(field ? `${tFields(field)}: ${error.message}` : error.message);
    }
    return parts.join(' ');
  };
}
