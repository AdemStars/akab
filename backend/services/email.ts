export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailService {
  private static sentEmails: EmailPayload[] = [];

  static async sendEmail(payload: EmailPayload): Promise<boolean> {
    // In production, nodemailer or standard SMTP transport can be hooked here.
    // In testing and dev mode, emails are securely logged and stored in memory for assertions.
    this.sentEmails.push({
      ...payload,
    });

    if (process.env.NODE_ENV !== 'test') {
      console.log(`[EMAIL DISPATCH] To: ${payload.to} | Subject: ${payload.subject}`);
    }

    return true;
  }

  static async sendSignalConfirmation(
    to: string,
    signalId: string,
    forgetToken: string
  ): Promise<boolean> {
    const subject = `[AKAB] Confirmation de votre signalement #${signalId}`;
    const text = `
Bonjour,

Votre signalement a bien été enregistré sous la référence : ${signalId}.
Il est actuellement en attente de modération par l'équipe AKAB.

IMPORTANT - DROIT À L'OUBLI (RGPD) :
Vos coordonnées (email/téléphone) seront automatiquement supprimées après 30 jours.
Si vous souhaitez les supprimer immédiatement, vous pouvez utiliser votre jeton confidentiel :
Jeton Droit à l'Oubli : ${forgetToken}

En cas de rejet, vous pourrez également déposer un recours depuis la plateforme.

Solidairement,
L'équipe AKAB
    `.trim();

    return this.sendEmail({ to, subject, text });
  }

  static async sendAppealConfirmation(to: string, signalId: string): Promise<boolean> {
    const subject = `[AKAB] Recours enregistré pour le signalement #${signalId}`;
    const text = `
Bonjour,

Votre demande de recours pour le signalement #${signalId} a bien été transmise à notre collège de modération.
Elle sera réexaminée dans les plus brefs délais.

L'équipe AKAB
    `.trim();

    return this.sendEmail({ to, subject, text });
  }

  static getSentEmails(): EmailPayload[] {
    return this.sentEmails;
  }

  static clearSentEmails(): void {
    this.sentEmails = [];
  }
}
