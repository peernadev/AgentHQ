// Contract for the about page: GET /api/team.

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio?: string;
  avatar_url?: string;
  github?: string;
}

export interface TeamResponse {
  members: TeamMember[];
}
