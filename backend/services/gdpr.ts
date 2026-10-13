import { SignalModel } from '../models/Signal';
import { UserModel } from '../models/User';
import { config } from '../config';

export class GdprService {
  /**
   * Purges personal contact details (email and phone number) for signals older than 30 days.
   * Keeps anonymized validated reports indefinitely for public interest and research (GDPR Art. 89).
   */
  static cleanExpiredData(): { cleanedCount: number; timestamp: string } {
    const cleanedCount = SignalModel.anonymizeExpired();
    return {
      cleanedCount,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Implements the Right to be Forgotten (GDPR Article 17).
   * A citizen can erase their contact info (email and phone) immediately using their secret forget token.
   */
  static forgetByToken(forgetToken: string): { success: boolean; message: string; signalId?: string } {
    const signal = SignalModel.findByForgetToken(forgetToken);
    const user = UserModel.findByForgetToken(forgetToken);

    if (!signal && !user) {
      return {
        success: false,
        message: 'Jeton de droit à l’oubli invalide ou déjà utilisé.',
      };
    }

    if (signal) {
      SignalModel.anonymizeContact(signal.id);
    }
    if (user) {
      UserModel.deleteByForgetToken(forgetToken);
    }

    return {
      success: true,
      message: 'Vos données personnelles (email, téléphone) ont été définitivement supprimées.',
      signalId: signal ? signal.id : undefined,
    };
  }

  /**
   * Right of access (GDPR Article 15) - allows reporter to inspect their stored data.
   */
  static inspectUserData(forgetToken: string) {
    const signal = SignalModel.findByForgetToken(forgetToken);
    if (!signal) {
      return null;
    }

    return {
      signalId: signal.id,
      title: signal.title,
      createdAt: signal.createdAt,
      incidentDate: signal.incidentDate,
      status: signal.status,
      contact: {
        email: signal.reporterEmail ? 'Présent (chiffré / temporaire)' : 'Déjà anonymisé / supprimé',
        phone: signal.reporterPhone ? 'Présent (chiffré / temporaire)' : 'Déjà anonymisé / supprimé',
        retentionExpiresAt: signal.retentionExpiresAt,
        anonymizedAt: signal.anonymizedAt,
      },
      gdprRetentionDays: config.gdprRetentionDays,
    };
  }

  /**
   * Returns official GDPR privacy statement.
   */
  static getPrivacyPolicy() {
    return {
      platform: 'AKAB - Plateforme Citoyenne de Signalement des Violences Policières',
      framework: 'Règlement Général sur la Protection des Données (RGPD - Règlement UE 2016/679)',
      dataController: 'Collectif AKAB (décentralisé et open-source)',
      purposes: [
        'Documentation citoyenne des violences policières',
        'Constitution d’un registre public d’intérêt général (Art. 89 RGPD)',
        'Mise à disposition de données anonymisées pour journalistes, chercheurs et avocats',
      ],
      retentionPolicy: {
        personalContactData: `Suppression automatique et irréversible après ${config.gdprRetentionDays} jours`,
        validatedSignalReports: 'Conservation indéfinie sous forme strictement anonymisée (Art. 89 RGPD)',
        mediaProofs: 'Stockage décentralisé IPFS avec anonymisation préalable (carrés noirs sur visages et plaques)',
      },
      userRights: [
        'Droit à l’oubli (Art. 17) : suppression immédiate de vos contacts via votre jeton secret',
        'Droit d’accès (Art. 15) : consultation de vos données de contact',
        'Droit de recours : contestation manuelle en cas de rejet d’un signalement',
      ],
      securityMeasures: [
        'Suppression automatique des métadonnées EXIF des images',
        'Anonymisation visuelle (carrés noirs sur visages et plaques)',
        'Aucun tracking tiers ni cookies publicitaires',
        'Chiffrement en transit (HTTPS)',
      ],
    };
  }
}
