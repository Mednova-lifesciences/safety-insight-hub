import { supabase } from "@/integrations/supabase/client";
import { apiRequest } from "./client";
import { cases as casesApi, type NewIcsrPayload } from "./cases";
import { newId, recordAudit, toJson } from "./db";
import type {
  DynamicField,
  PatientInfo,
  ReactionEvent,
  ReporterInfo,
  SuspectProduct,
} from "@/types/pv";

export type ConversationStatus = "OPEN" | "READY_FOR_REVIEW" | "CONVERTED" | "CLOSED";

export interface RequiredQuestion {
  id: string;
  text: string;
}

export interface IntakeSettings {
  whatsappNumber: string | null;
  autoRespondDefault: boolean;
  requiredQuestions: RequiredQuestion[];
}

export interface RequiredQuestionStatus {
  questionId: string;
  answered: boolean;
  answerSummary?: string | null;
}

export interface WhatsAppConversationData {
  phoneNumber: string;
  status: ConversationStatus;
  autoRespond: boolean;
  reporter: Partial<ReporterInfo>;
  patient: Partial<PatientInfo>;
  suspectProducts: SuspectProduct[];
  reactions: ReactionEvent[];
  narrative: string;
  dynamicFields: DynamicField[];
  wantsAnotherProduct: boolean | null;
  requiredQuestionsStatus: RequiredQuestionStatus[];
  lastMessageAt: string;
  linkedCaseId?: string;
}

export interface WhatsAppConversation {
  id: string;
  data: WhatsAppConversationData;
}

export interface WhatsAppMessage {
  id: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  sender: "REPORTER" | "AI" | "STAFF" | "SYSTEM";
  body: string;
  createdAt: string;
}

function settingsFromRow(row: {
  whatsapp_number: string | null;
  auto_respond_default: boolean;
  required_questions: unknown;
}): IntakeSettings {
  return {
    whatsappNumber: row.whatsapp_number,
    autoRespondDefault: row.auto_respond_default,
    requiredQuestions: Array.isArray(row.required_questions)
      ? (row.required_questions as RequiredQuestion[])
      : [],
  };
}

function conversationFromRow(row: { id: string; data: unknown }): WhatsAppConversation {
  return { id: row.id, data: row.data as WhatsAppConversationData };
}

function messageFromRow(row: {
  id: string;
  conversation_id: string;
  direction: string;
  sender: string;
  body: string;
  created_at: string;
}): WhatsAppMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction as WhatsAppMessage["direction"],
    sender: row.sender as WhatsAppMessage["sender"],
    body: row.body,
    createdAt: row.created_at,
  };
}

export const whatsapp = {
  getSettings: async (): Promise<IntakeSettings> => {
    const { data, error } = await supabase.from("pv_intake_settings").select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data
      ? settingsFromRow(data)
      : { whatsappNumber: null, autoRespondDefault: true, requiredQuestions: [] };
  },

  saveSettings: async (settings: IntakeSettings): Promise<void> => {
    const { error } = await supabase.from("pv_intake_settings").upsert(
      {
        whatsapp_number: settings.whatsappNumber,
        auto_respond_default: settings.autoRespondDefault,
        required_questions: toJson(settings.requiredQuestions),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "INTAKE_SETTINGS_UPDATED",
      entity: "IntakeSettings",
      entityId: settings.whatsappNumber ?? "unset",
      reason: "WhatsApp intake settings updated",
    });
  },

  listConversations: async (): Promise<WhatsAppConversation[]> => {
    const { data, error } = await supabase
      .from("pv_intake_conversations")
      .select("id,data")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    // pv_intake_conversations is shared with the older, separate generic
    // "Inbound intake" feature (src/routes/_app/intake.*.tsx) — its own
    // seeded demo rows live in this same table under a completely
    // different shape (flat reporterName, a different status enum, no
    // phoneNumber at all). Only this feature's own rows ever have
    // phoneNumber, so that's the cheapest reliable discriminator without
    // touching the other feature's data.
    return (data ?? [])
      .filter((row) => typeof (row.data as { phoneNumber?: unknown } | null)?.phoneNumber === "string")
      .map(conversationFromRow);
  },

  getConversation: async (id: string): Promise<WhatsAppConversation> => {
    const { data, error } = await supabase
      .from("pv_intake_conversations")
      .select("id,data")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Conversation ${id} was not found.`);
    return conversationFromRow(data);
  },

  listMessages: async (conversationId: string): Promise<WhatsAppMessage[]> => {
    const { data, error } = await supabase
      .from("pv_intake_messages")
      .select("id,conversation_id,direction,sender,body,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(messageFromRow);
  },

  setAutoRespond: async (conversation: WhatsAppConversation, enabled: boolean): Promise<void> => {
    const nextData = { ...conversation.data, autoRespond: enabled };
    const { error } = await supabase
      .from("pv_intake_conversations")
      .update({ data: toJson(nextData), updated_at: new Date().toISOString() })
      .eq("id", conversation.id);
    if (error) throw new Error(error.message);
  },

  /** Sends via the FastAPI proxy (holds the Termii secret), then records
   *  the message itself directly — same split as every other write in
   *  this app, kept as narrow as the secret actually requires. */
  sendStaffReply: async (
    conversation: WhatsAppConversation,
    message: string,
    staffUserId: string,
  ): Promise<void> => {
    const result = await apiRequest<{ termiiMessageId: string }>("/api/whatsapp/send", {
      method: "POST",
      body: { conversationId: conversation.id, message },
    });
    const { error } = await supabase.from("pv_intake_messages").insert({
      id: newId("msg"),
      conversation_id: conversation.id,
      direction: "OUTBOUND",
      sender: "STAFF",
      staff_user_id: staffUserId,
      body: message,
      termii_message_id: result.termiiMessageId,
    });
    if (error) throw new Error(error.message);
  },

  dismissDynamicField: async (conversation: WhatsAppConversation, index: number): Promise<void> => {
    const nextFields = conversation.data.dynamicFields.filter((_, i) => i !== index);
    const nextData = { ...conversation.data, dynamicFields: nextFields };
    const { error } = await supabase
      .from("pv_intake_conversations")
      .update({ data: toJson(nextData) })
      .eq("id", conversation.id);
    if (error) throw new Error(error.message);
  },

  terminate: async (conversation: WhatsAppConversation): Promise<void> => {
    const nextData = { ...conversation.data, status: "CLOSED" as const };
    const { error } = await supabase
      .from("pv_intake_conversations")
      .update({ data: toJson(nextData) })
      .eq("id", conversation.id);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "INTAKE_TERMINATED",
      entity: "IntakeConversation",
      entityId: conversation.id,
      reason: "Reviewer determined this WhatsApp conversation does not warrant an ICSR",
    });
  },

  /** Builds a NewIcsrPayload from the conversation's AI-extracted state
   *  and creates the case through the same cases.create()/buildCaseDetail()
   *  path the manual ICSR form uses — no separate case-creation logic. */
  convertToCase: async (
    conversation: WhatsAppConversation,
    assignedTo: string,
  ): Promise<{ caseId: string }> => {
    const d = conversation.data;
    const primary = d.suspectProducts[0];
    const primaryReaction = d.reactions[0];
    // NewIcsrPayload's field types are already Record<string, unknown> /
    // loosely-optional throughout (see cases.ts) — this app's existing
    // exactOptionalPropertyTypes friction with that shape shows up
    // wherever a concrete object is passed to it, not something specific
    // to this call.
    const payload = {
      reporter: {
        name: d.reporter.name ?? "Unknown reporter",
        qualification: d.reporter.qualification ?? "",
        country: d.reporter.country ?? "",
        contact: d.reporter.contact ?? d.phoneNumber,
      },
      patient: {
        identifier: d.patient.identifier ?? "Unknown",
        age: d.patient.age ?? "",
        sex: d.patient.sex ?? "",
        weightKg: d.patient.weightKg ?? "",
        medicalHistory: d.patient.medicalHistory ?? "",
      },
      product: {
        reportedName: primary?.reportedName ?? "Unspecified product",
        dose: primary?.dose ?? "",
        route: primary?.route ?? "",
        indication: primary?.indication ?? "",
        batchNumber: primary?.batchNumber ?? "",
      },
      reaction: {
        reportedTerm: primaryReaction?.reportedTerm ?? "Unspecified reaction",
        onsetDate: primaryReaction?.onsetDate ?? "",
        outcome: primaryReaction?.outcome ?? "UNKNOWN",
      },
      narrative: d.narrative,
      reportedSeriousness: "UNASSESSED",
      seriousnessCriteria: [],
      additionalInformation: "Captured via the WhatsApp intake channel.",
      additionalProducts: d.suspectProducts.slice(1),
      dynamicFields: d.dynamicFields,
    } satisfies Record<string, unknown> as unknown as NewIcsrPayload;
    const created = await casesApi.create(payload);
    const nextData = { ...d, status: "CONVERTED" as const, linkedCaseId: created.caseId };
    await supabase.from("pv_intake_conversations").update({ data: toJson(nextData) }).eq("id", conversation.id);
    await recordAudit({
      action: "INTAKE_CONVERTED",
      entity: "IntakeConversation",
      entityId: conversation.id,
      newValue: created.caseId,
      reason: `Converted to case by ${assignedTo}`,
    });
    return created;
  },
};
