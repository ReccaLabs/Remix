'use client';
import { ApiError } from '@remix/types/api';
import { useTranslations } from 'next-intl';
import { FormAlert } from '@/components/form-alert';

export type FeeFailure = 'load' | 'validation' | 'cash' | 'paid' | 'conflict' | 'forbidden' | 'notFound' | 'network';
export function feeFailure(error: unknown): FeeFailure {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.problem.code) {
    case 'ALREADY_PAID': return 'paid';
    case 'VALIDATION_FAILED': return 'validation';
    case 'CONFLICT': return 'conflict';
    case 'FORBIDDEN': return 'forbidden';
    case 'NOT_FOUND': return 'notFound';
    default: return 'network';
  }
}
export function FeeError({ failure }: { failure: FeeFailure | null }) {
  const t = useTranslations('fees.errors');
  return failure ? <FormAlert>{t(failure)}</FormAlert> : null;
}
