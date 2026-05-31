'use client'

import React, { useState, useCallback } from 'react'
import {
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'

const CONDITION_META: Record<string, { label: string; color: string; bg: string }> = {
  default:     { label: 'Padrão',     color: '#3b82f6', bg: '#eff6ff' },
  yes:         { label: '✅ Sim',      color: '#10b981', bg: '#ecfdf5' },
  no:          { label: '❌ Não',      color: '#ef4444', bg: '#fef2f2' },
  replied:     { label: 'Respondeu',  color: '#8b5cf6', bg: '#f5f3ff' },
  purchased:   { label: 'Comprou',    color: '#f59e0b', bg: '#fffbeb' },
  clicked:     { label: 'Clicou',     color: '#6366f1', bg: '#eef2ff' },
  opened:      { label: 'Abriu',      color: '#10b981', bg: '#ecfdf5' },
  not_opened:  { label: 'Não abriu',  color: '#ef4444', bg: '#fef2f2' },
  not_clicked: { label: 'Não clicou', color: '#f97316', bg: '#fff7ed' },
}

const CONDITIONS = Object.entries(CONDITION_META).map(([value, meta]) => ({ value, ...meta }))
