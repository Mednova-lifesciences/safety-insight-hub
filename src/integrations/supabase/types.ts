export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      pv_audit_events: {
        Row: {
          data: Json;
          id: string;
          occurred_at: string;
          organization_id: string;
        };
        Insert: {
          data: Json;
          id: string;
          occurred_at?: string;
          organization_id?: string;
        };
        Update: {
          data?: Json;
          id?: string;
          occurred_at?: string;
          organization_id?: string;
        };
        Relationships: [];
      };
      pv_cases: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id: string;
          organization_id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_products: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id: string;
          organization_id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_coding_history: {
        Row: {
          case_id: string;
          created_at: string;
          data: Json;
          id: string;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          data: Json;
          id: string;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          data?: Json;
          id?: string;
        };
        Relationships: [];
      };
      pv_coding_suggestions: {
        Row: {
          case_id: string;
          data: Json;
          id: string;
        };
        Insert: {
          case_id: string;
          data: Json;
          id: string;
        };
        Update: {
          case_id?: string;
          data?: Json;
          id?: string;
        };
        Relationships: [];
      };
      pv_dictionary_terms: {
        Row: {
          code: string;
          created_at: string;
          dictionary: string;
          dictionary_version: string;
          id: string;
          kind: string;
          synonyms: string[];
          term: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          dictionary: string;
          dictionary_version: string;
          id: string;
          kind: string;
          synonyms?: string[];
          term: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          dictionary?: string;
          dictionary_version?: string;
          id?: string;
          kind?: string;
          synonyms?: string[];
          term?: string;
        };
        Relationships: [];
      };
      pv_intake_conversations: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
          organization_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id: string;
          organization_id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_intake_messages: {
        Row: {
          body: string;
          conversation_id: string;
          created_at: string;
          direction: string;
          id: string;
          organization_id: string;
          sender: string;
          staff_user_id: string | null;
          termii_message_id: string | null;
        };
        Insert: {
          body: string;
          conversation_id: string;
          created_at?: string;
          direction: string;
          id: string;
          organization_id?: string;
          sender: string;
          staff_user_id?: string | null;
          termii_message_id?: string | null;
        };
        Update: {
          body?: string;
          conversation_id?: string;
          created_at?: string;
          direction?: string;
          id?: string;
          organization_id?: string;
          sender?: string;
          staff_user_id?: string | null;
          termii_message_id?: string | null;
        };
        Relationships: [];
      };
      pv_intake_settings: {
        Row: {
          auto_respond_default: boolean;
          organization_id: string;
          required_questions: Json;
          updated_at: string;
          whatsapp_number: string | null;
        };
        Insert: {
          auto_respond_default?: boolean;
          organization_id?: string;
          required_questions?: Json;
          updated_at?: string;
          whatsapp_number?: string | null;
        };
        Update: {
          auto_respond_default?: boolean;
          organization_id?: string;
          required_questions?: Json;
          updated_at?: string;
          whatsapp_number?: string | null;
        };
        Relationships: [];
      };
      pv_regulatory_config: {
        Row: {
          case_id_prefix: string | null;
          environment: string;
          organization_id: string;
          outcome_codes: Json;
          receiver_identifier: string | null;
          receiver_organization: string | null;
          report_type: string | null;
          report_type_confirmed: boolean;
          sender_identifier: string | null;
          sender_organization: string | null;
          sender_person_responsible: string | null;
          sender_type: string | null;
          updated_at: string;
        };
        Insert: {
          case_id_prefix?: string | null;
          environment?: string;
          organization_id?: string;
          outcome_codes?: Json;
          receiver_identifier?: string | null;
          receiver_organization?: string | null;
          report_type?: string | null;
          report_type_confirmed?: boolean;
          sender_identifier?: string | null;
          sender_organization?: string | null;
          sender_person_responsible?: string | null;
          sender_type?: string | null;
          updated_at?: string;
        };
        Update: {
          case_id_prefix?: string | null;
          environment?: string;
          organization_id?: string;
          outcome_codes?: Json;
          receiver_identifier?: string | null;
          receiver_organization?: string | null;
          report_type?: string | null;
          report_type_confirmed?: boolean;
          sender_identifier?: string | null;
          sender_organization?: string | null;
          sender_person_responsible?: string | null;
          sender_type?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_e2b_regulatory_assessments: {
        Row: {
          assessment_type: string;
          case_id: string;
          created_at: string;
          data: Json;
          id: string;
          job_id: string;
          organization_id: string;
          assessment_version: number;
          supersedes_id: string | null;
          updated_at: string;
        };
        Insert: {
          assessment_type: string;
          case_id: string;
          created_at?: string;
          data?: Json;
          id: string;
          job_id: string;
          organization_id?: string;
          assessment_version?: number;
          supersedes_id?: string | null;
          updated_at?: string;
        };
        Update: {
          assessment_type?: string;
          case_id?: string;
          created_at?: string;
          data?: Json;
          id?: string;
          job_id?: string;
          organization_id?: string;
          assessment_version?: number;
          supersedes_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_e2b_c17_rules: {
        Row: {
          changed_by: string;
          changed_by_role: string;
          created_at: string;
          id: string;
          jurisdiction: string;
          name: string;
          note: string | null;
          organization_id: string;
          rule: Json;
          status: string;
          supersedes_id: string | null;
          version: string;
        };
        Insert: {
          changed_by: string;
          changed_by_role: string;
          created_at?: string;
          id: string;
          jurisdiction: string;
          name: string;
          note?: string | null;
          organization_id?: string;
          rule: Json;
          status: string;
          supersedes_id?: string | null;
          version: string;
        };
        Update: {
          changed_by?: string;
          changed_by_role?: string;
          created_at?: string;
          id?: string;
          jurisdiction?: string;
          name?: string;
          note?: string | null;
          organization_id?: string;
          rule?: Json;
          status?: string;
          supersedes_id?: string | null;
          version?: string;
        };
        Relationships: [];
      };
      pv_e2b_c17_ai_assessments: {
        Row: {
          assessment_id: string | null;
          case_id: string;
          created_at: string;
          data: Json;
          id: string;
          input_snapshot_hash: string;
          input_version: string;
          model: string | null;
          model_version: string | null;
          organization_id: string;
          prompt_version: string;
          provider: string;
          rule_id: string;
          rule_version: string;
          status: string;
        };
        Insert: {
          assessment_id?: string | null;
          case_id: string;
          created_at?: string;
          data: Json;
          id: string;
          input_snapshot_hash: string;
          input_version: string;
          model?: string | null;
          model_version?: string | null;
          organization_id?: string;
          prompt_version: string;
          provider: string;
          rule_id: string;
          rule_version: string;
          status: string;
        };
        Update: never;
        Relationships: [];
      };
      pv_term_mappings: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          kind: string;
          term: string;
          term_key: string;
          mapped_value: string | null;
          mapped_label: string | null;
          ai_suggestion: string | null;
          ai_suggestion_label: string | null;
          ai_confidence: number | null;
          ai_reason: string | null;
          first_seen_file: string | null;
          decided_by: string | null;
          decided_at: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          organization_id?: string;
          kind: string;
          term: string;
          term_key: string;
          mapped_value?: string | null;
          mapped_label?: string | null;
          ai_suggestion?: string | null;
          ai_suggestion_label?: string | null;
          ai_confidence?: number | null;
          ai_reason?: string | null;
          first_seen_file?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          kind?: string;
          term?: string;
          term_key?: string;
          mapped_value?: string | null;
          mapped_label?: string | null;
          ai_suggestion?: string | null;
          ai_suggestion_label?: string | null;
          ai_confidence?: number | null;
          ai_reason?: string | null;
          first_seen_file?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_reporter_qualification_mappings: {
        Row: {
          created_at: string;
          designation: string;
          designation_key: string;
          id: string;
          organization_id: string;
          qualification_code: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          designation: string;
          designation_key: string;
          id: string;
          organization_id?: string;
          qualification_code?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          designation?: string;
          designation_key?: string;
          id?: string;
          organization_id?: string;
          qualification_code?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_follow_ups: {
        Row: {
          case_id: string;
          created_at: string;
          data: Json;
          id: string;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          data: Json;
          id: string;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          data?: Json;
          id?: string;
        };
        Relationships: [];
      };
      pv_linelist_issues: {
        Row: {
          data: Json;
          id: string;
          job_id: string;
        };
        Insert: {
          data: Json;
          id: string;
          job_id: string;
        };
        Update: {
          data?: Json;
          id?: string;
          job_id?: string;
        };
        Relationships: [];
      };
      pv_linelist_jobs: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
        };
        Relationships: [];
      };
      pv_notifications: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
        };
        Relationships: [];
      };
      pv_psur_documents: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
        };
        Relationships: [];
      };
      pv_psur_findings: {
        Row: {
          data: Json;
          document_id: string;
          id: string;
        };
        Insert: {
          data: Json;
          document_id: string;
          id: string;
        };
        Update: {
          data?: Json;
          document_id?: string;
          id?: string;
        };
        Relationships: [];
      };
      pv_seriousness: {
        Row: {
          case_id: string;
          data: Json;
          updated_at: string;
        };
        Insert: {
          case_id: string;
          data: Json;
          updated_at?: string;
        };
        Update: {
          case_id?: string;
          data?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      pv_signals: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
        };
        Insert: {
          created_at?: string;
          data: Json;
          id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          invite_code: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          invite_code: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          invite_code?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          job_title: string | null;
          organization_id: string;
          phone: string | null;
          role: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          job_title?: string | null;
          organization_id: string;
          phone?: string | null;
          role: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          job_title?: string | null;
          organization_id?: string;
          phone?: string | null;
          role?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_organization_invite_code: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      delete_my_organization: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      save_e2b_c17_recommendation: {
        Args: {
          p_assessment: Json;
          p_assessment_id: string;
          p_case_id: string;
          p_job_id: string;
          p_supersedes_id?: string | null;
        };
        Returns: Json;
      };
      finalize_e2b_c17_assessment: {
        Args: {
          p_assessment_id: string;
          p_decision: string;
          p_rationale: string;
        };
        Returns: Json;
      };
      finalize_e2b_c17_assessments_bulk: {
        Args: {
          p_assessment_ids: string[];
          p_decision: string;
          p_rationale: string;
        };
        Returns: Json;
      };
      save_e2b_c17_rule: {
        Args: {
          p_note?: string | null;
          p_rule: Json;
        };
        Returns: Json;
      };
      finalize_e2b_c17_as_recommended: {
        Args: {
          p_assessment_ids: string[];
          p_rationale: string;
        };
        Returns: Json;
      };
      save_e2b_c17_ai_assessment: {
        Args: {
          p_ai_assessment_id: string;
          p_case_id: string;
          p_data: Json;
          p_input_snapshot_hash: string;
          p_input_version: string;
          p_model: string | null;
          p_model_version: string | null;
          p_prompt_version: string;
          p_provider: string;
          p_regulatory_assessment_id: string | null;
          p_rule_id: string;
          p_rule_version: string;
          p_status: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
