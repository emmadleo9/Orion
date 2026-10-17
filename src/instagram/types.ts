export type MediaType = 'IMAGE' | 'VIDEO' | 'REELS' | 'STORIES' | 'CAROUSEL';

export interface InstagramAccount { id: string; username?: string; name?: string; biography?: string; profile_picture_url?: string; followers_count?: number; follows_count?: number; media_count?: number; }
export interface InstagramMedia { id: string; caption?: string; media_type?: string; media_product_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number; }
export interface PageInfo { next?: string; previous?: string; }
export interface InstagramListResponse<T> { data: T[]; paging?: PageInfo; }
export interface InstagramInsightsResponse { data: Array<{ name: string; period?: string; values?: Array<{ value: number | Record<string, number>; end_time?: string }>; title?: string; description?: string; }>; }
export interface PublishingLimit { data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>; quota_usage?: number; quota_total?: number; }
export interface GraphErrorPayload { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string; }; }
export interface ContainerStatus { id?: string; status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'; status?: string; error_message?: string; }
export interface CreateContainerInput { mediaType: MediaType; imageUrl?: string; videoUrl?: string; caption?: string; altText?: string; isCarouselItem?: boolean; children?: string[]; }
export interface CarouselItemInput { mediaType: 'IMAGE' | 'VIDEO'; imageUrl?: string; videoUrl?: string; }
export interface PublishResult { containerId: string; mediaId: string; }

export interface InstagramComment { id: string; text?: string; username?: string; timestamp?: string; like_count?: number; }
export interface InstagramCommentsResponse { data: InstagramComment[]; paging?: PageInfo; }
export interface EngagementSummary { mediaId: string; likes: number; comments: number; saves: number; shares: number; reach: number; impressions: number; totalInteractions: number; recentComments: InstagramComment[]; }

export interface ScheduledPost { id: string; publishAt: string; createdAt: string; updatedAt: string; status: 'SCHEDULED' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED'; payload: CreateContainerInput | { mediaType: 'CAROUSEL'; items: CarouselItemInput[]; caption?: string }; result?: PublishResult; error?: string; }
export interface ScheduleCreateInput { publishAt: string; payload: ScheduledPost['payload']; }
export interface CaptionRequest { topic: string; tone?: 'bold' | 'warm' | 'playful' | 'professional'; callToAction?: string; hashtagCount?: number; }
export interface CaptionSuggestion { caption: string; hashtags: string[]; }
