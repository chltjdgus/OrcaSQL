/**
 * @xyflow/react 타입 선언 스텁.
 * 실제 패키지 설치 시 자동으로 교체된다.
 * `bun install` 전 TypeScript 컴파일을 통과하기 위한 최소 선언.
 */
declare module '@xyflow/react' {
  import type { CSSProperties, ReactNode, ComponentType } from 'react'

  export interface Node<T extends Record<string, unknown> = Record<string, unknown>> {
    id: string
    type?: string
    position: { x: number; y: number }
    data: T
    style?: CSSProperties
  }

  export interface Edge {
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    label?: string
    style?: CSSProperties
    labelStyle?: CSSProperties
    type?: string
    animated?: boolean
  }

  export type NodeChange = { id: string; type: string; [key: string]: unknown }
  export type EdgeChange = { id: string; type: string; [key: string]: unknown }

  export function useNodesState<T extends Node>(
    initialNodes: T[],
  ): [T[], React.Dispatch<React.SetStateAction<T[]>>, (changes: NodeChange[]) => void]

  export function useEdgesState<T extends Edge>(
    initialEdges: T[],
  ): [T[], React.Dispatch<React.SetStateAction<T[]>>, (changes: EdgeChange[]) => void]

  export enum Position {
    Left = 'left',
    Right = 'right',
    Top = 'top',
    Bottom = 'bottom',
  }

  export function Handle(props: {
    type: 'source' | 'target'
    position: Position
    id?: string
    style?: CSSProperties
  }): JSX.Element

  export interface ReactFlowProps {
    nodes: Node[]
    edges: Edge[]
    onNodesChange?: (changes: NodeChange[]) => void
    onEdgesChange?: (changes: EdgeChange[]) => void
    nodeTypes?: Record<string, ComponentType<{ data: Record<string, unknown> }>>
    fitView?: boolean
    fitViewOptions?: { padding?: number }
    style?: CSSProperties
    proOptions?: { hideAttribution?: boolean }
    children?: ReactNode
  }

  export type { ComponentType }

  export function ReactFlow(props: ReactFlowProps): JSX.Element

  export function Background(props: { color?: string; gap?: number }): JSX.Element
  export function Controls(props: { style?: CSSProperties }): JSX.Element
  export function MiniMap(props: {
    nodeColor?: string
    maskColor?: string
    style?: CSSProperties
  }): JSX.Element
}
