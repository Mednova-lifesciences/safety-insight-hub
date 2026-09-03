export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      pv_audit_events: {
        Row: {
          data: Json
          id: string
          occurred_at: string
          organization_id: string
        }
        Insert: {
          data: Json
          id: string
          occurred_at?: string
          organization_id?: string
        }
        Update: {
          data?: Json
          id?: string
          occurred_at?: string
          organization_id?: string
        }
        Relationships: []
      }
      pv_cases: {
        Row: {
          created_at: string
          data: Json
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
          organization_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pv_products: {
        Row: {
          created_at: string
          data: Json
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
          organization_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pv_coding_history: {
        Row: {
          case_id: string
          created_at: string
          data: Json
          id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          data: Json
          id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      pv_coding_suggestions: {
        Row: {
          case_id: string
          data: Json
          id: string
        }
        Insert: {
          case_id: string
          data: Json
          id: string
        }
        Update: {
          case_id?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      pv_dictionary_terms: {
        Row: {
          code: string
          created_at: string
          dictionary: string
          dictionary_version: string
          id: string
          kind: string
          synonyms: string[]
          term: string
        }
        Insert: {
          code: string
          created_at?: string
          dictionary: string
          dictionary_version: string
          id: string
          kind: string
          synonyms?: string[]
          term: string
        }
        Update: {
          code?: string
          created_at?: string
          dictionary?: string
          dictionary_version?: string
          id?: string
          kind?: string
          synonyms?: string[]
          term?: string
        }
        Relationships: []
      }
      pv_follow_ups: {
        Row: {
          case_id: string
          created_at: string
          data: Json
          id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          data: Json
          id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      pv_intake_conversations: {
        Row: {
          created_at: string
          data: Json
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pv_linelist_issues: {
        Row: {
          data: Json
          id: string
          job_id: string
        }
        Insert: {
          data: Json
          id: string
          job_id: string
        }
        Update: {
          data?: Json
          id?: string
          job_id?: string
        }
        Relationships: []
      }
      pv_linelist_jobs: {
        Row: {
          created_at: string
          data: Json
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      pv_notifications: {
        Row: {
          created_at: string
          data: Json
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      pv_psur_documents: {
        Row: {
          created_at: string
          data: Json
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      pv_psur_findings: {
        Row: {
          data: Json
          document_id: string
          id: string
        }
        Insert: {
          data: Json
          document_id: string
          id: string
        }
        Update: {
          data?: Json
          document_id?: string
          id?: string
        }
        Relationships: []
      }
      pv_seriousness: {
        Row: {
          case_id: string
          data: Json
          updated_at: string
        }
        Insert: {
          case_id: string
          data: Json
          updated_at?: string
        }
        Update: {
          case_id?: string
          data?: Json
          updated_at?: string
        }
        Relationships: []
      }
      pv_signals: {
        Row: {
          created_at: string
          data: Json
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          invite_code: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_code: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
