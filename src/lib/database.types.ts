export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      clips: {
        Row: {
          created_at: string
          embedding: string | null
          format: Database["public"]["Enums"]["clip_format"]
          hook: string | null
          hook_type: string | null
          id: string
          opus_clip_id: string | null
          score_hook: number | null
          score_loopability: number | null
          score_payoff: number | null
          score_standalone: number | null
          score_tension: number | null
          score_total: number | null
          source_video_id: string
          status: Database["public"]["Enums"]["clip_status"]
          title: string
          transcript: string | null
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          format: Database["public"]["Enums"]["clip_format"]
          hook?: string | null
          hook_type?: string | null
          id?: string
          opus_clip_id?: string | null
          score_hook?: number | null
          score_loopability?: number | null
          score_payoff?: number | null
          score_standalone?: number | null
          score_tension?: number | null
          score_total?: number | null
          source_video_id: string
          status?: Database["public"]["Enums"]["clip_status"]
          title: string
          transcript?: string | null
        }
        Update: {
          created_at?: string
          embedding?: string | null
          format?: Database["public"]["Enums"]["clip_format"]
          hook?: string | null
          hook_type?: string | null
          id?: string
          opus_clip_id?: string | null
          score_hook?: number | null
          score_loopability?: number | null
          score_payoff?: number | null
          score_standalone?: number | null
          score_tension?: number | null
          score_total?: number | null
          source_video_id?: string
          status?: Database["public"]["Enums"]["clip_status"]
          title?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clips_source_video_id_fkey"
            columns: ["source_video_id"]
            isOneToOne: false
            referencedRelation: "source_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      learnings: {
        Row: {
          created_at: string
          id: string
          reasoning: string
          week_start: string
          what_changed: string[]
          what_worked: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          reasoning: string
          week_start: string
          what_changed?: string[]
          what_worked?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          reasoning?: string
          week_start?: string
          what_changed?: string[]
          what_worked?: string[]
        }
        Relationships: []
      }
      metrics: {
        Row: {
          avg_percent_watched: number | null
          captured_at: string
          comments: number | null
          follows_gained: number | null
          id: string
          post_id: string
          saves: number | null
          shares: number | null
          views: number | null
        }
        Insert: {
          avg_percent_watched?: number | null
          captured_at?: string
          comments?: number | null
          follows_gained?: number | null
          id?: string
          post_id: string
          saves?: number | null
          shares?: number | null
          views?: number | null
        }
        Update: {
          avg_percent_watched?: number | null
          captured_at?: string
          comments?: number | null
          follows_gained?: number | null
          id?: string
          post_id?: string
          saves?: number | null
          shares?: number | null
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metrics_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          caption: string | null
          clip_id: string
          created_at: string
          id: string
          platform: Database["public"]["Enums"]["platform"]
          platform_post_id: string | null
          posted_at: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["post_status"]
        }
        Insert: {
          caption?: string | null
          clip_id: string
          created_at?: string
          id?: string
          platform: Database["public"]["Enums"]["platform"]
          platform_post_id?: string | null
          posted_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["post_status"]
        }
        Update: {
          caption?: string | null
          clip_id?: string
          created_at?: string
          id?: string
          platform?: Database["public"]["Enums"]["platform"]
          platform_post_id?: string | null
          posted_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["post_status"]
        }
        Relationships: [
          {
            foreignKeyName: "posts_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
        ]
      }
      source_videos: {
        Row: {
          channel: string
          created_at: string
          duration_seconds: number | null
          id: string
          title: string
          youtube_url: string
        }
        Insert: {
          channel: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          title: string
          youtube_url: string
        }
        Update: {
          channel?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          title?: string
          youtube_url?: string
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
      clip_format: "mock" | "conversational"
      clip_status:
        | "candidate"
        | "approved"
        | "rejected"
        | "scheduled"
        | "posted"
      platform: "youtube" | "tiktok" | "instagram"
      post_status: "scheduled" | "posted" | "failed" | "canceled"
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
    Enums: {
      clip_format: ["mock", "conversational"],
      clip_status: ["candidate", "approved", "rejected", "scheduled", "posted"],
      platform: ["youtube", "tiktok", "instagram"],
      post_status: ["scheduled", "posted", "failed", "canceled"],
    },
  },
} as const

