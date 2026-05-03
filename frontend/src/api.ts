import type { ColorExploreResponse, ColorTripletExploreResponse, ScoreResponse } from './types';

const API_BASE = '';

export async function scoreImages(files: File[], threshold: number): Promise<ScoreResponse> {
  const body = new FormData();
  files.forEach((file) => body.append('files', file));
  body.append('threshold', String(threshold));

  const response = await fetch(`${API_BASE}/api/score`, {
    method: 'POST',
    body
  });

  if (!response.ok) {
    throw new Error(await responseText(response));
  }

  return response.json();
}

export async function exploreColors(file: File, threshold: number): Promise<ColorExploreResponse> {
  const body = new FormData();
  body.append('file', file);
  body.append('threshold', String(threshold));

  const response = await fetch(`${API_BASE}/api/color-explore`, {
    method: 'POST',
    body
  });

  if (!response.ok) {
    throw new Error(await responseText(response));
  }

  return response.json();
}

export async function exploreTriplets(limit = 24): Promise<ColorTripletExploreResponse> {
  const body = new FormData();
  body.append('limit', String(limit));

  const response = await fetch(`${API_BASE}/api/tricolor-explore`, {
    method: 'POST',
    body
  });

  if (!response.ok) {
    throw new Error(await responseText(response));
  }

  return response.json();
}

export async function getTripletExplore(jobId: string): Promise<ColorTripletExploreResponse> {
  const response = await fetch(`${API_BASE}/api/tricolor-explore/${jobId}`);

  if (!response.ok) {
    throw new Error(await responseText(response));
  }

  return response.json();
}

async function responseText(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return payload.detail ?? 'Request failed.';
  } catch {
    return 'Request failed.';
  }
}
