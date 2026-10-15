export interface Signal {
  id: string;
  title: string;
  description: string;
  incidentDate: string;
  incidentType: string;
  eventType: string;
  eventName: string | null;
  victimAgeGroup?: string;
  latitude: number;
  longitude: number;
  locationAccuracyMeters: number | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  department: string | null;
  evidence: Array<{
    id: string;
    cid: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    anonymized: boolean;
    isVideo: boolean;
  }>;
  status: 'pending' | 'validated' | 'rejected' | 'under_appeal';
  rejectionReason?: string | null;
  appealReason?: string | null;
  validationScore?: number;
  moderation?: {
    approvals: number;
    required: number;
    approvedByMe: boolean;
    rejectedByMe: boolean;
  };
  reporterEmail?: string | null;
  reporterPhone?: string | null;
  forgetToken?: string;
  createdAt: string;
}

export interface SignalFilters {
  startDate?: string;
  endDate?: string;
  incidentType?: string;
  city?: string;
  department?: string;
  limit?: number;
  offset?: number;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const CACHE_KEY = 'akab_cached_signals';

export const API = {
  async getSignals(filters: SignalFilters = {}): Promise<{ signals: Signal[]; total: number }> {
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.incidentType) params.set('incidentType', filters.incidentType);
      if (filters.city) params.set('city', filters.city);
      if (filters.department) params.set('department', filters.department);
      if (filters.limit) params.set('limit', String(filters.limit));
      if (filters.offset) params.set('offset', String(filters.offset));

      const res = await fetch(`/api/signals?${params.toString()}`);
      if (!res.ok) throw new Error('Erreur lors du chargement des signalements');
      const data = await res.json();

      // Save to offline cache
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data.signals));
      } catch {}

      return data;
    } catch (err) {
      // Fallback to offline cache
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const signals = JSON.parse(cached);
          return { signals, total: signals.length };
        } catch {}
      }
      throw err;
    }
  },

  async getSignalById(id: string): Promise<Signal> {
    const res = await fetch(`/api/signals/${id}`);
    if (!res.ok) throw new Error('Signalement introuvable');
    const data = await res.json();
    return data.signal;
  },

  async uploadProof(file: File | Blob, anonymized: boolean): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('anonymized', String(anonymized));

    const res = await fetch('/api/signals/upload-proof', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur lors de l’envoi de la preuve sur IPFS');
    }

    return res.json();
  },

  async submitSignal(payload: any): Promise<{ signalId: string; forgetToken: string }> {
    const res = await fetch('/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const details = err.details ? err.details.map((d: any) => d.message).join(', ') : err.error;
      throw new Error(details || 'Erreur lors de l’envoi du signalement');
    }

    return res.json();
  },

  async submitAppeal(id: string, reason: string): Promise<any> {
    const res = await fetch(`/api/signals/${id}/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur lors du dépôt de recours');
    }

    return res.json();
  },

  async forgetData(forgetToken: string): Promise<any> {
    const res = await fetch('/api/signals/forget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forgetToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur lors de la suppression des données');
    }

    return res.json();
  },

  async rightToBeForgotten(forgetToken: string): Promise<any> {
    return this.forgetData(forgetToken);
  },

  async getStatistics(): Promise<any> {
    const res = await fetch('/api/export/statistics');
    if (!res.ok) throw new Error('Erreur lors du chargement des statistiques');
    const data = await res.json();
    return data.stats;
  },

  async getPrivacyPolicy(): Promise<any> {
    const res = await fetch('/api/gdpr/policy');
    if (!res.ok) throw new Error('Erreur lors du chargement de la politique');
    const data = await res.json();
    return data.policy;
  },

  // Admin APIs
  async adminLogin(email: string, password: string): Promise<{ token: string; user: any }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(err.error || 'Identifiants incorrects', res.status);
    }

    return res.json();
  },

  async getAdminSignals(token: string, status?: string, search?: string): Promise<any> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const res = await fetch(`/api/admin/signals?${params.toString()}`, {
      headers: { Authorization: 'Bearer ' + token },
    });

    if (!res.ok) throw new ApiError('Erreur de chargement des signalements admin', res.status);
    return res.json();
  },

  async validateSignal(token: string, id: string, force = false): Promise<any> {
    const res = await fetch(`/api/admin/signals/${id}/validate`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(err.error || 'Erreur lors de la validation', res.status);
    }
    return res.json();
  },

  async rejectSignal(token: string, id: string, reason: string): Promise<any> {
    const res = await fetch(`/api/admin/signals/${id}/reject`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(err.error || 'Erreur lors du rejet', res.status);
    }
    return res.json();
  },

  async getValidators(token: string): Promise<any> {
    const res = await fetch('/api/admin/validators', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new ApiError('Erreur chargement modérateurs', res.status);
    return res.json();
  },

  async createValidator(
    token: string,
    input: { email: string; name: string; password: string; role: 'admin' | 'moderator' }
  ): Promise<any> {
    return adminJson(token, '/api/admin/validators', 'POST', input);
  },

  async updateValidator(
    token: string,
    id: string,
    changes: { role?: 'admin' | 'moderator'; isActive?: boolean; password?: string }
  ): Promise<any> {
    return adminJson(token, `/api/admin/validators/${id}`, 'PATCH', changes);
  },

  async getStorageStatus(token: string): Promise<any> {
    return adminJson(token, '/api/admin/storage', 'GET');
  },

  async repairStorage(token: string): Promise<any> {
    return adminJson(token, '/api/admin/storage/repair', 'POST', {});
  },

  async backupStorage(token: string): Promise<any> {
    return adminJson(token, '/api/admin/storage/backup', 'POST', {});
  },

  async getAuditLog(token: string, action?: string, offset = 0): Promise<any> {
    const params = new URLSearchParams({ limit: '50', offset: String(offset) });
    if (action) params.set('action', action);
    return adminJson(token, `/api/admin/audit?${params.toString()}`, 'GET');
  },
};

async function adminJson(token: string, url: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err.error || 'Erreur de requête', res.status);
  }
  return res.json();
}
