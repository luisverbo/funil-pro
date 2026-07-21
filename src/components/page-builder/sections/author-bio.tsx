'use client'

import { useNode } from '@craftjs/core'
import React from 'react'
import { ImageInput } from '../image-input'

interface AuthorBioProps {
  photoUrl?: string
  name?: string
  jobTitle?: string
  bio?: string
  instagramUrl?: string
  youtubeUrl?: string
  whatsappNumber?: string
  bgColor?: string
  paddingY?: number
}

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

export const AuthorBio = ({
  photoUrl = '',
  name = 'Luis Carlos',
  jobTitle = 'Especialista em Marketing Digital',
  bio = 'Com mais de 10 anos de experiência no mercado digital, ajudei centenas de empreendedores a transformarem seus negócios com estratégias comprovadas de marketing e vendas online.',
  instagramUrl = '',
  youtubeUrl = '',
  whatsappNumber = '',
  bgColor = '#ffffff',
  paddingY = 48,
}: AuthorBioProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }} className="w-full px-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
          <div className="flex-shrink-0">
            {photoUrl ? (
              <img src={photoUrl} alt={name} className="w-32 h-32 rounded-full object-cover shadow-lg border-4 border-white" />
            ) : (
              <div className="w-32 h-32 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-lg" style={{ backgroundColor: '#6366f1' }}>{getInitials(name)}</div>
            )}
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="text-2xl font-bold text-gray-900 mb-1">{name}</h3>
            <p className="text-indigo-600 font-medium mb-4">{jobTitle}</p>
            <p className="text-gray-600 leading-relaxed mb-5">{bio}</p>
            <div className="flex items-center justify-center md:justify-start gap-4">
              {instagramUrl && <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-pink-600">Instagram</a>}
              {youtubeUrl && <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-red-600">YouTube</a>}
              {whatsappNumber && <a href={`https://wa.me/${whatsappNumber.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-green-600">WhatsApp</a>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const AuthorBioSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as AuthorBioProps }))
  return (
    <div className="space-y-3">
      <ImageInput label="Foto" value={props.photoUrl} onChange={(url) => setProp((p: AuthorBioProps) => { p.photoUrl = url })} />
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Nome</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.name} onChange={(e) => setProp((p: AuthorBioProps) => { p.name = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cargo</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.jobTitle} onChange={(e) => setProp((p: AuthorBioProps) => { p.jobTitle = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Bio</label><textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={4} value={props.bio} onChange={(e) => setProp((p: AuthorBioProps) => { p.bio = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Instagram (URL)</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.instagramUrl} onChange={(e) => setProp((p: AuthorBioProps) => { p.instagramUrl = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">YouTube (URL)</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.youtubeUrl} onChange={(e) => setProp((p: AuthorBioProps) => { p.youtubeUrl = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">WhatsApp (número)</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" placeholder="5511999999999" value={props.whatsappNumber} onChange={(e) => setProp((p: AuthorBioProps) => { p.whatsappNumber = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: AuthorBioProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

AuthorBio.craft = {
  displayName: 'Bio do Autor',
  props: { photoUrl: '', name: 'Luis Carlos', jobTitle: 'Especialista em Marketing Digital', bio: 'Com mais de 10 anos de experiência no mercado digital, ajudei centenas de empreendedores a transformarem seus negócios.', instagramUrl: '', youtubeUrl: '', whatsappNumber: '', bgColor: '#ffffff', paddingY: 48 },
  related: { toolbar: AuthorBioSettings },
}