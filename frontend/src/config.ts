const match = window.location.pathname.match(/^\/(mtl|sunny-bd)/)
export const BAND_NAME = match ? match[1] : ''
export const ROUTE_PREFIX = BAND_NAME ? `/${BAND_NAME}` : ''
export const API_BASE = import.meta.env.VITE_API_URL || ROUTE_PREFIX
