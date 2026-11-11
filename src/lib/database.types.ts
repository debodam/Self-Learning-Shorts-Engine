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
      agent_runs: {
        Row: {
          cache_creation_input_tokens: number
          cache_read_input_tokens: number
          cost_usd: number | null
          error: string | null
          finished_at: string | null
          id: string
          input_tokens: number
          items_failed: number
          items_processed: number
          kind: string
          model: string
          output_tokens: number
          started_at: string
        }
        Insert: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          cost_usd?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input_tokens?: number
          items_failed?: number
          items_processed?: number
          kind: string
          model: string
          output_tokens?: number
          started_at?: string
        }
        Update: {
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
          cost_usd?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input_tokens?: number
          items_failed?: number
          items_processed?: number
          kind?: string
          model?: string
          output_tokens?: number
          started_at?: string
        }
        Relationships: []
      }
      clips: {
        Row: {
          created_at: string
          duration_seconds: number | null
          embedded_at: string | null
          embedding: string | null
          embedding_model: string | null
          prediction_reason: string | null
          prompt_version: number | null
          predicted_views_expected: number | null
          predicted_views_high: number | null
          predicted_views_low: number | null
          similar_shorts: Json | null
          format: Database["public"]["Enums"]["clip_format"]
          hook: string | null
          hook_type: string | null
          id: string
          opus_clip_id: string | null
          predicted_views_instagram: number | null
          predicted_views_tiktok: number | null
          predicted_views_youtube: number | null
          score_hook: number | null
          score_loopability: number | null
          score_payoff: number | null
          score_reasoning: string | null
          score_standalone: number | null
          score_tension: number | null
          score_total: number | null
          scored_at: string | null
          source_video_id: string
          status: Database["public"]["Enums"]["clip_status"]
          suggested_title: string | null
          title: string
          transcript: string | null
          youtube_description: string | null
          youtube_title: string | null
          cut_reason: string | null
          face_frames: number | null
          frames_checked: number | null
          people_count: number | null
          text_readable: boolean | null
          picked: boolean
          captions_generated_at: string | null
          instagram_caption: string | null
          tiktok_caption: string | null
          caption: string | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          embedded_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          prediction_reason?: string | null
          prompt_version?: number | null
          predicted_views_expected?: number | null
          predicted_views_high?: number | null
          predicted_views_low?: number | null
          similar_shorts?: Json | null
          format: Database["public"]["Enums"]["clip_format"]
          hook?: string | null
          hook_type?: string | null
          id?: string
          opus_clip_id?: string | null
          predicted_views_instagram?: number | null
          predicted_views_tiktok?: number | null
          predicted_views_youtube?: number | null
          score_hook?: number | null
          score_loopability?: number | null
          score_payoff?: number | null
          score_reasoning?: string | null
          score_standalone?: number | null
          score_tension?: number | null
          score_total?: number | null
          scored_at?: string | null
          source_video_id: string
          status?: Database["public"]["Enums"]["clip_status"]
          suggested_title?: string | null
          title: string
          transcript?: string | null
          youtube_description?: string | null
          youtube_title?: string | null
          cut_reason?: string | null
          face_frames?: number | null
          frames_checked?: number | null
          people_count?: number | null
          text_readable?: boolean | null
          picked?: boolean
          captions_generated_at?: string | null
          instagram_caption?: string | null
          tiktok_caption?: string | null
          caption?: string | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          embedded_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          prediction_reason?: string | null
          prompt_version?: number | null
          predicted_views_expected?: number | null
          predicted_views_high?: number | null
          predicted_views_low?: number | null
          similar_shorts?: Json | null
          format?: Database["public"]["Enums"]["clip_format"]
          hook?: string | null
          hook_type?: string | null
          id?: string
          opus_clip_id?: string | null
          predicted_views_instagram?: number | null
          predicted_views_tiktok?: number | null
          predicted_views_youtube?: number | null
          score_hook?: number | null
          score_loopability?: number | null
          score_payoff?: number | null
          score_reasoning?: string | null
          score_standalone?: number | null
          score_tension?: number | null
          score_total?: number | null
          scored_at?: string | null
          source_video_id?: string
          status?: Database["public"]["Enums"]["clip_status"]
          suggested_title?: string | null
          title?: string
          transcript?: string | null
          youtube_description?: string | null
          youtube_title?: string | null
          cut_reason?: string | null
          face_frames?: number | null
          frames_checked?: number | null
          people_count?: number | null
          text_readable?: boolean | null
          picked?: boolean
          captions_generated_at?: string | null
          instagram_caption?: string | null
          tiktok_caption?: string | null
          caption?: string | null
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
          what_didnt_work: string[]
          patterns: Json | null
          accuracy: Json | null
          cost_usd: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          reasoning: string
          week_start: string
          what_changed?: string[]
          what_worked?: string[]
          what_didnt_work?: string[]
          patterns?: Json | null
          accuracy?: Json | null
          cost_usd?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          reasoning?: string
          week_start?: string
          what_changed?: string[]
          what_worked?: string[]
          what_didnt_work?: string[]
          patterns?: Json | null
          accuracy?: Json | null
          cost_usd?: number | null
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
          account_name: string | null
          match_note: string | null
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
          account_name?: string | null
          match_note?: string | null
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
          account_name?: string | null
          match_note?: string | null
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
          opus_project_id: string | null
          title: string
          youtube_url: string
          opus_checked_at: string | null
          opus_status: string | null
          week_id: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          opus_project_id?: string | null
          title: string
          youtube_url: string
          opus_checked_at?: string | null
          opus_status?: string | null
          week_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          opus_project_id?: string | null
          title?: string
          youtube_url?: string
          opus_checked_at?: string | null
          opus_status?: string | null
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_videos_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      weeks: {
        Row: {
          created_at: string
          id: string
          starts_on: string
        }
        Insert: {
          created_at?: string
          id?: string
          starts_on: string
        }
        Update: {
          created_at?: string
          id?: string
          starts_on?: string
        }
        Relationships: []
      }
      youtube_short_snapshots: {
        Row: {
          captured_at: string
          comments: number | null
          id: string
          likes: number | null
          video_id: string
          views: number
        }
        Insert: {
          captured_at?: string
          comments?: number | null
          id?: string
          likes?: number | null
          video_id: string
          views: number
        }
        Update: {
          captured_at?: string
          comments?: number | null
          id?: string
          likes?: number | null
          video_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "youtube_short_snapshots_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "youtube_shorts"
            referencedColumns: ["video_id"]
          },
        ]
      }
      youtube_shorts: {
        Row: {
          comments: number | null
          created_at: string
          description: string
          duration_seconds: number
          embedded_at: string | null
          embedding: string | null
          embedding_model: string | null
          format: string | null
          format_confidence: string | null
          format_labeled_at: string | null
          format_model: string | null
          format_reason: string | null
          last_pulled_at: string
          likes: number | null
          post_id: string | null
          published_at: string
          settled_views: number | null
          thumbnail_url: string | null
          title: string
          video_id: string
          views: number
          views_48h: number | null
          views_7d: number | null
        }
        Insert: {
          comments?: number | null
          created_at?: string
          description?: string
          duration_seconds: number
          embedded_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          format?: string | null
          format_confidence?: string | null
          format_labeled_at?: string | null
          format_model?: string | null
          format_reason?: string | null
          last_pulled_at?: string
          likes?: number | null
          post_id?: string | null
          published_at: string
          settled_views: number | null
          thumbnail_url: string | null
          title: string
          video_id: string
          views?: number
          views_48h?: number | null
          views_7d?: number | null
        }
        Update: {
          comments?: number | null
          created_at?: string
          description?: string
          duration_seconds?: number
          embedded_at?: string | null
          embedding?: string | null
          embedding_model?: string | null
          format?: string | null
          format_confidence?: string | null
          format_labeled_at?: string | null
          format_model?: string | null
          format_reason?: string | null
          last_pulled_at?: string
          likes?: number | null
          post_id?: string | null
          published_at?: string
          settled_views?: number | null
          thumbnail_url?: string | null
          title?: string
          video_id?: string
          views?: number
          views_48h?: number | null
          views_7d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "youtube_shorts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          id: string
          version: number
          text: string
          notes: string
          active: boolean
          proposal_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          version: number
          text: string
          notes?: string
          active?: boolean
          proposal_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          version?: number
          text?: string
          notes?: string
          active?: boolean
          proposal_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      backtest_runs: {
        Row: {
          id: string
          created_at: string
          finished_at: string | null
          label: string
          prompt_version: number | null
          proposal_id: string | null
          model: string
          shorts_count: number
          spearman: number | null
          range_hit_rate: number | null
          top7_hit_rate: number | null
          top7_groups: number | null
          input_tokens: number
          output_tokens: number
          cache_read_input_tokens: number
          cache_creation_input_tokens: number
          cost_usd: number | null
          error: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          finished_at?: string | null
          label: string
          prompt_version?: number | null
          proposal_id?: string | null
          model: string
          shorts_count?: number
          spearman?: number | null
          range_hit_rate?: number | null
          top7_hit_rate?: number | null
          top7_groups?: number | null
          input_tokens?: number
          output_tokens?: number
          cache_read_input_tokens?: number
          cache_creation_input_tokens?: number
          cost_usd?: number | null
          error?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          finished_at?: string | null
          label?: string
          prompt_version?: number | null
          proposal_id?: string | null
          model?: string
          shorts_count?: number
          spearman?: number | null
          range_hit_rate?: number | null
          top7_hit_rate?: number | null
          top7_groups?: number | null
          input_tokens?: number
          output_tokens?: number
          cache_read_input_tokens?: number
          cache_creation_input_tokens?: number
          cost_usd?: number | null
          error?: string | null
        }
        Relationships: []
      }
      backtest_predictions: {
        Row: {
          run_id: string
          video_id: string
          rubric_total: number | null
          predicted_low: number | null
          predicted_expected: number | null
          predicted_high: number | null
          actual_settled: number
          reason: string | null
        }
        Insert: {
          run_id: string
          video_id: string
          rubric_total?: number | null
          predicted_low?: number | null
          predicted_expected?: number | null
          predicted_high?: number | null
          actual_settled: number
          reason?: string | null
        }
        Update: {
          run_id?: string
          video_id?: string
          rubric_total?: number | null
          predicted_low?: number | null
          predicted_expected?: number | null
          predicted_high?: number | null
          actual_settled?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backtest_predictions_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "youtube_shorts"
            referencedColumns: ["video_id"]
          },
        ]
      }
      accuracy_snapshots: {
        Row: {
          id: string
          created_at: string
          source: string
          prompt_version: number | null
          items_count: number
          spearman: number | null
          range_hit_rate: number | null
          top7_hit_rate: number | null
          backtest_run_id: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          source: string
          prompt_version?: number | null
          items_count?: number
          spearman?: number | null
          range_hit_rate?: number | null
          top7_hit_rate?: number | null
          backtest_run_id?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          source?: string
          prompt_version?: number | null
          items_count?: number
          spearman?: number | null
          range_hit_rate?: number | null
          top7_hit_rate?: number | null
          backtest_run_id?: string | null
        }
        Relationships: []
      }
      prompt_proposals: {
        Row: {
          id: string
          learning_id: string | null
          created_at: string
          base_version: number
          title: string
          reasoning: string
          old_text: string
          new_text: string
          status: string
          rejection_reason: string | null
          decided_at: string | null
          resulting_version: number | null
          baseline_run_id: string | null
          backtest_run_id: string | null
        }
        Insert: {
          id?: string
          learning_id?: string | null
          created_at?: string
          base_version: number
          title: string
          reasoning: string
          old_text: string
          new_text: string
          status?: string
          rejection_reason?: string | null
          decided_at?: string | null
          resulting_version?: number | null
          baseline_run_id?: string | null
          backtest_run_id?: string | null
        }
        Update: {
          id?: string
          learning_id?: string | null
          created_at?: string
          base_version?: number
          title?: string
          reasoning?: string
          old_text?: string
          new_text?: string
          status?: string
          rejection_reason?: string | null
          decided_at?: string | null
          resulting_version?: number | null
          baseline_run_id?: string | null
          backtest_run_id?: string | null
        }
        Relationships: []
      }
      report_runs: {
        Row: {
          id: string
          started_at: string
          finished_at: string | null
          trigger: string
          status: string
          message: string | null
        }
        Insert: {
          id?: string
          started_at?: string
          finished_at?: string | null
          trigger: string
          status?: string
          message?: string | null
        }
        Update: {
          id?: string
          started_at?: string
          finished_at?: string | null
          trigger?: string
          status?: string
          message?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_similar_shorts_before: {
        Args: {
          query_embedding: string
          published_before: string
          match_count?: number
        }
        Returns: {
          video_id: string
          title: string
          format: string | null
          published_at: string
          settled_views: number
          similarity: number
        }[]
      }
      match_similar_shorts: {
        Args: {
          query_embedding: string
          match_count?: number
          min_age_days?: number
          exclude_clip_id?: string | null
        }
        Returns: {
          video_id: string
          title: string
          format: string | null
          published_at: string
          settled_views: number
          similarity: number
        }[]
      }
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

