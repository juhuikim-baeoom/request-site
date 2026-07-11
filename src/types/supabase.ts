// =====================================================================
// Supabase 자동 생성 타입 (source of truth)
// 재생성: npx supabase gen types typescript --project-id edpfpmunpfahkoomeril
//   또는 Supabase MCP generate_typescript_types
// 편의 별칭(Profile/RequestRow/RequestOrg 등)은 ./database.ts 참조.
// =====================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      org_directory: {
        Row: {
          created_at: string
          dept: string
          dept_function: string | null
          email: string
          name: string
          org_affil: Database['public']['Enums']['request_org']
          role: Database['public']['Enums']['user_role']
          synced: boolean
        }
        Insert: {
          created_at?: string
          dept: string
          dept_function?: string | null
          email: string
          name: string
          org_affil: Database['public']['Enums']['request_org']
          role?: Database['public']['Enums']['user_role']
          synced?: boolean
        }
        Update: {
          created_at?: string
          dept?: string
          dept_function?: string | null
          email?: string
          name?: string
          org_affil?: Database['public']['Enums']['request_org']
          role?: Database['public']['Enums']['user_role']
          synced?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          dept: string | null
          dept_function: string | null
          email: string
          id: string
          name: string | null
          org: string | null
          org_affil: Database['public']['Enums']['request_org'] | null
          role: Database['public']['Enums']['user_role']
        }
        Insert: {
          created_at?: string
          dept?: string | null
          dept_function?: string | null
          email: string
          id: string
          name?: string | null
          org?: string | null
          org_affil?: Database['public']['Enums']['request_org'] | null
          role?: Database['public']['Enums']['user_role']
        }
        Update: {
          created_at?: string
          dept?: string | null
          dept_function?: string | null
          email?: string
          id?: string
          name?: string | null
          org?: string | null
          org_affil?: Database['public']['Enums']['request_org'] | null
          role?: Database['public']['Enums']['user_role']
        }
        Relationships: []
      }
      request_attachments: {
        Row: {
          comment_id: number | null
          created_at: string
          file_name: string | null
          file_size: number | null
          id: number
          mime_type: string | null
          request_id: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          comment_id?: number | null
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          id?: never
          mime_type?: string | null
          request_id: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          comment_id?: number | null
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          id?: never
          mime_type?: string | null
          request_id?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'request_attachments_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'request_view'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_attachments_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'requests'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      request_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: number
          is_internal: boolean
          request_id: number
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: never
          is_internal?: boolean
          request_id: number
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: never
          is_internal?: boolean
          request_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'request_comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_comments_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'request_view'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_comments_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'requests'
            referencedColumns: ['id']
          },
        ]
      }
      request_shared_targets: {
        Row: {
          created_at: string
          id: number
          request_id: number
          target_type: string
          target_value: string
        }
        Insert: {
          created_at?: string
          id?: never
          request_id: number
          target_type: string
          target_value: string
        }
        Update: {
          created_at?: string
          id?: never
          request_id?: number
          target_type?: string
          target_value?: string
        }
        Relationships: [
          {
            foreignKeyName: 'request_shared_targets_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'request_view'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_shared_targets_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'requests'
            referencedColumns: ['id']
          },
        ]
      }
      request_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database['public']['Enums']['request_status'] | null
          id: number
          request_id: number
          to_status: Database['public']['Enums']['request_status']
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database['public']['Enums']['request_status'] | null
          id?: never
          request_id: number
          to_status: Database['public']['Enums']['request_status']
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database['public']['Enums']['request_status'] | null
          id?: never
          request_id?: number
          to_status?: Database['public']['Enums']['request_status']
        }
        Relationships: [
          {
            foreignKeyName: 'request_status_history_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_status_history_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'request_view'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_status_history_request_id_fkey'
            columns: ['request_id']
            isOneToOne: false
            referencedRelation: 'requests'
            referencedColumns: ['id']
          },
        ]
      }
      request_types: {
        Row: {
          active: boolean | null
          code: string
          label: string
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          code: string
          label: string
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          code?: string
          label?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      requests: {
        Row: {
          assigned_at: string | null
          assignee_id: string | null
          body: string | null
          completed_at: string | null
          created_at: string
          desired_due: string | null
          final_resolved_at: string | null
          first_completed_at: string | null
          first_resolved_at: string | null
          id: number
          impact: Database['public']['Enums']['urgency_level'] | null
          intake_detail: Json | null
          is_locked: boolean
          org: Database['public']['Enums']['request_org']
          parent_request_id: number | null
          priority_level: string | null
          requester_dept: string | null
          requester_email: string | null
          requester_function: string | null
          requester_id: string | null
          requester_name: string | null
          requester_org: Database['public']['Enums']['request_org'] | null
          resolution_due_at: string | null
          response_due_at: string | null
          rework_count: number
          seq: string | null
          sla_resolution_breached: boolean | null
          sla_response_breached: boolean | null
          source: Database['public']['Enums']['request_source']
          source_thread_id: string | null
          status: Database['public']['Enums']['request_status']
          title: string
          type_code: string
          updated_at: string
          urgency: Database['public']['Enums']['urgency_level'] | null
          visibility: Database['public']['Enums']['request_visibility']
        }
        Insert: {
          assigned_at?: string | null
          assignee_id?: string | null
          body?: string | null
          completed_at?: string | null
          created_at?: string
          desired_due?: string | null
          final_resolved_at?: string | null
          first_completed_at?: string | null
          first_resolved_at?: string | null
          id?: never
          impact?: Database['public']['Enums']['urgency_level'] | null
          intake_detail?: Json | null
          is_locked?: boolean
          org: Database['public']['Enums']['request_org']
          parent_request_id?: number | null
          priority_level?: string | null
          requester_dept?: string | null
          requester_email?: string | null
          requester_function?: string | null
          requester_id?: string | null
          requester_name?: string | null
          requester_org?: Database['public']['Enums']['request_org'] | null
          resolution_due_at?: string | null
          response_due_at?: string | null
          rework_count?: number
          seq?: string | null
          sla_resolution_breached?: boolean | null
          sla_response_breached?: boolean | null
          source?: Database['public']['Enums']['request_source']
          source_thread_id?: string | null
          status?: Database['public']['Enums']['request_status']
          title: string
          type_code: string
          updated_at?: string
          urgency?: Database['public']['Enums']['urgency_level'] | null
          visibility?: Database['public']['Enums']['request_visibility']
        }
        Update: {
          assigned_at?: string | null
          assignee_id?: string | null
          body?: string | null
          completed_at?: string | null
          created_at?: string
          desired_due?: string | null
          final_resolved_at?: string | null
          first_completed_at?: string | null
          first_resolved_at?: string | null
          id?: never
          impact?: Database['public']['Enums']['urgency_level'] | null
          intake_detail?: Json | null
          is_locked?: boolean
          org?: Database['public']['Enums']['request_org']
          parent_request_id?: number | null
          priority_level?: string | null
          requester_dept?: string | null
          requester_email?: string | null
          requester_function?: string | null
          requester_id?: string | null
          requester_name?: string | null
          requester_org?: Database['public']['Enums']['request_org'] | null
          resolution_due_at?: string | null
          response_due_at?: string | null
          rework_count?: number
          seq?: string | null
          sla_resolution_breached?: boolean | null
          sla_response_breached?: boolean | null
          source?: Database['public']['Enums']['request_source']
          source_thread_id?: string | null
          status?: Database['public']['Enums']['request_status']
          title?: string
          type_code?: string
          updated_at?: string
          urgency?: Database['public']['Enums']['urgency_level'] | null
          visibility?: Database['public']['Enums']['request_visibility']
        }
        Relationships: [
          {
            foreignKeyName: 'requests_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_parent_request_id_fkey'
            columns: ['parent_request_id']
            isOneToOne: false
            referencedRelation: 'request_view'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_parent_request_id_fkey'
            columns: ['parent_request_id']
            isOneToOne: false
            referencedRelation: 'requests'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_type_code_fkey'
            columns: ['type_code']
            isOneToOne: false
            referencedRelation: 'request_types'
            referencedColumns: ['code']
          },
        ]
      }
    }
    Views: {
      request_view: {
        Row: {
          assigned_at: string | null
          assignee_id: string | null
          body: string | null
          completed_at: string | null
          created_at: string | null
          csat_comment: string | null
          csat_rating: number | null
          desired_due: string | null
          due_status: string | null
          final_lead_days: number | null
          final_resolved_at: string | null
          first_completed_at: string | null
          first_lead_days: number | null
          first_response_at: string | null
          first_resolved_at: string | null
          hold_reason: string | null
          id: number | null
          impact: Database['public']['Enums']['urgency_level'] | null
          intake_detail: Json | null
          is_locked: boolean | null
          org: Database['public']['Enums']['request_org'] | null
          parent_request_id: number | null
          priority_level: string | null
          reject_reason: string | null
          requester_dept: string | null
          requester_email: string | null
          requester_function: string | null
          requester_id: string | null
          requester_name: string | null
          requester_org: Database['public']['Enums']['request_org'] | null
          resolution_due_at: string | null
          response_due_at: string | null
          rework_count: number | null
          rework_reason: string | null
          seq: string | null
          sla_policy_id: number | null
          sla_resolution_breached: boolean | null
          sla_response_breached: boolean | null
          source: Database['public']['Enums']['request_source'] | null
          source_thread_id: string | null
          status: Database['public']['Enums']['request_status'] | null
          title: string | null
          type_code: string | null
          type_label: string | null
          updated_at: string | null
          urgency: Database['public']['Enums']['urgency_level'] | null
          visibility: Database['public']['Enums']['request_visibility'] | null
        }
        Relationships: [
          {
            foreignKeyName: 'requests_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_parent_request_id_fkey'
            columns: ['parent_request_id']
            isOneToOne: false
            referencedRelation: 'request_view'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_parent_request_id_fkey'
            columns: ['parent_request_id']
            isOneToOne: false
            referencedRelation: 'requests'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'requests_type_code_fkey'
            columns: ['type_code']
            isOneToOne: false
            referencedRelation: 'request_types'
            referencedColumns: ['code']
          },
        ]
      }
    }
    Functions: {
      can_see_request: { Args: { req_id: number }; Returns: boolean }
      is_system: { Args: never; Returns: boolean }
      is_viewer_up: { Args: never; Returns: boolean }
      list_dept_options: {
        Args: never
        Returns: {
          dept_function: string
          org_affil: Database['public']['Enums']['request_org']
        }[]
      }
      my_dept: { Args: never; Returns: string }
      my_function: { Args: never; Returns: string }
      my_org: {
        Args: never
        Returns: Database['public']['Enums']['request_org']
      }
    }
    Enums: {
      request_org: '배움' | '배론' | '허브' | '공통'
      request_priority: '긴급' | '보통' | '낮음'
      request_source: 'web' | 'email'
      request_status:
        | '접수'
        | '진행중'
        | '보류'
        | '완료'
        | '반려'
        | '철회'
      request_visibility: 'private' | 'dept' | 'function' | 'org' | 'shared'
      urgency_level: '높음' | '보통' | '낮음'
      user_role: 'staff' | 'system' | 'viewer'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
