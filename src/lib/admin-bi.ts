export type AdminBiPayload = {
  days: Array<{ day: string; new_users: number }>;
  total_users: number;
  events: {
    configured: boolean;
    error?: string;
    range?: { days: number };
    by_event?: Array<{
      event: string;
      actor: string;
      n: number;
      avg_ms: number | null;
    }>;
    top_relations?: Array<{
      course_id: string;
      teacher_id: string;
      views: number;
    }>;
  };
};
