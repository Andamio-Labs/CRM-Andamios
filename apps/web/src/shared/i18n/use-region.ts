import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api';
import { createFormatters, DEFAULT_REGION } from './format';
import { translator } from './messages';

interface TenantRegion {
  locale: string;
  currency: string;
  timezone: string;
}

/** Formatos y textos según la configuración de la empresa (E01-S06 + E14-S02). */
export function useRegion() {
  const settings = useQuery({ queryKey: ['tenant-settings'], queryFn: () => api<TenantRegion>('/api/v1/tenant/settings'), staleTime: 5 * 60_000 });
  const region = settings.data
    ? { locale: settings.data.locale, currency: settings.data.currency, timeZone: settings.data.timezone }
    : DEFAULT_REGION;
  return useMemo(() => ({ ...createFormatters(region), t: translator(region.locale), region }), [region.locale, region.currency, region.timeZone]);
}
