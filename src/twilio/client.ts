import twilio from "twilio";
import type { ServiceInstance } from "twilio/lib/rest/verify/v2/service.js";
import type { ServicePage } from "twilio/lib/rest/verify/v2/service.js";
import type {
  VerificationAttemptInstance,
  VerificationAttemptPage
} from "twilio/lib/rest/verify/v2/verificationAttempt.js";
import type { MessageInstance, MessagePage } from "twilio/lib/rest/api/v2010/account/message.js";
import type { ServerConfig } from "../types.js";
import { invalidParams } from "../utils/errors.js";

export const READ_ONLY_TWILIO_OPERATIONS = Object.freeze([
  "api.v2010.account(<scoped>).messages.fetch",
  "api.v2010.account(<scoped>).messages.page",
  "verify.v2.services.fetch",
  "verify.v2.services.page",
  "verify.v2.verificationAttempts.fetch",
  "verify.v2.verificationAttempts.page"
]);

export interface MessagePageParams {
  dateSentAfter?: Date;
  dateSentBefore?: Date;
  from?: string;
  pageSize?: number;
  pageToken?: string;
  to?: string;
}

export interface VerifyAttemptPageParams {
  channel?: "call" | "email" | "rbm" | "sms" | "whatsapp";
  "channelData.to"?: string;
  dateCreatedAfter?: Date;
  dateCreatedBefore?: Date;
  pageSize?: number;
  pageToken?: string;
  status?: "converted" | "unconverted";
  verificationSid?: string;
  verifyServiceSid?: string;
}

export interface VerifyServicePageParams {
  pageSize?: number;
  pageToken?: string;
}

export class TwilioReadClient {
  private readonly client;

  constructor(private readonly config: ServerConfig) {
    this.client = twilio(this.config.authUsername, this.config.authPassword, {
      accountSid: this.config.effectiveAccountSid,
      autoRetry: true,
      lazyLoading: true,
      maxRetries: 3,
      timeout: this.config.requestTimeoutMs
    });
  }

  private get scopedMessages() {
    return this.client.api.v2010.accounts(this.config.effectiveAccountSid).messages;
  }

  private validateTwilioPageUrl(targetUrl: string, options: { pathPrefixes: string[] }): void {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw invalidParams("Invalid pagination URL returned or supplied in cursor.");
    }

    if (parsedUrl.protocol !== "https:") {
      throw invalidParams("Invalid pagination URL: only https Twilio URLs are allowed.");
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isTwilioHost = hostname === "twilio.com" || hostname.endsWith(".twilio.com");
    if (!isTwilioHost) {
      throw invalidParams("Invalid pagination URL: host must be a Twilio API domain.");
    }

    const pathname = parsedUrl.pathname;
    if (!options.pathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
      throw invalidParams("Invalid pagination URL: path is outside the allowed read-only Twilio resources.");
    }
  }

  private assertScopedAccount(accountSid: string, apiName: string): void {
    if (accountSid !== this.config.effectiveAccountSid) {
      throw invalidParams(
        `${apiName} response escaped the configured account scope. Configure credentials that are directly scoped to ${this.config.effectiveAccountSid} for this operation.`,
      );
    }
  }

  async fetchMessage(sid: string): Promise<MessageInstance> {
    const message = await this.scopedMessages(sid).fetch();
    this.assertScopedAccount(message.accountSid, "Messaging");
    return message;
  }

  async pageMessages(params: MessagePageParams): Promise<MessagePage> {
    const page = await this.scopedMessages.page(params);
    for (const message of page.instances) {
      this.assertScopedAccount(message.accountSid, "Messaging");
    }
    return page;
  }

  async getMessagePage(targetUrl: string): Promise<MessagePage> {
    this.validateTwilioPageUrl(targetUrl, {
      pathPrefixes: [`/2010-04-01/Accounts/${this.config.effectiveAccountSid}/Messages`]
    });
    const page = await this.scopedMessages.getPage(targetUrl);
    for (const message of page.instances) {
      this.assertScopedAccount(message.accountSid, "Messaging");
    }
    return page;
  }

  async fetchVerifyAttempt(sid: string): Promise<VerificationAttemptInstance> {
    const attempt = await this.client.verify.v2.verificationAttempts(sid).fetch();
    this.assertScopedAccount(attempt.accountSid, "Verify");
    return attempt;
  }

  async pageVerifyAttempts(params: VerifyAttemptPageParams): Promise<VerificationAttemptPage> {
    const page = await this.client.verify.v2.verificationAttempts.page(params);
    for (const attempt of page.instances) {
      this.assertScopedAccount(attempt.accountSid, "Verify");
    }
    return page;
  }

  async getVerifyAttemptPage(targetUrl: string): Promise<VerificationAttemptPage> {
    this.validateTwilioPageUrl(targetUrl, {
      pathPrefixes: ["/v2/Attempts"]
    });
    const page = await this.client.verify.v2.verificationAttempts.getPage(targetUrl);
    for (const attempt of page.instances) {
      this.assertScopedAccount(attempt.accountSid, "Verify");
    }
    return page;
  }

  async fetchVerifyService(sid: string): Promise<ServiceInstance> {
    const service = await this.client.verify.v2.services(sid).fetch();
    this.assertScopedAccount(service.accountSid, "Verify");
    return service;
  }

  async pageVerifyServices(params: VerifyServicePageParams): Promise<ServicePage> {
    const page = await this.client.verify.v2.services.page(params);
    for (const service of page.instances) {
      this.assertScopedAccount(service.accountSid, "Verify");
    }
    return page;
  }

  async getVerifyServicePage(targetUrl: string): Promise<ServicePage> {
    this.validateTwilioPageUrl(targetUrl, {
      pathPrefixes: ["/v2/Services"]
    });
    const page = await this.client.verify.v2.services.getPage(targetUrl);
    for (const service of page.instances) {
      this.assertScopedAccount(service.accountSid, "Verify");
    }
    return page;
  }
}
