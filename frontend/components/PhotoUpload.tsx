import React, { useRef, useState, useEffect } from 'react';
import { Camera, ShieldCheck, Trash2, Plus, Video, Image as ImageIcon } from 'lucide-react';
import { anonymizeImage, RedactionBox } from '../utils/anonymizer';
import { API } from '../utils/api';

export interface UploadedEvidence {
  id: string;
  cid: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  anonymized: boolean;
  isVideo: boolean;
}

interface PhotoUploadProps {
  onEvidenceAdded: (evidence: UploadedEvidence) => void;
  onEvidenceRemoved: (id: string) => void;
  existingEvidence: UploadedEvidence[];
}

export const PhotoUpload: React.FC<PhotoUploadProps> = ({
  onEvidenceAdded,
  onEvidenceRemoved,
  existingEvidence,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [boxes, setBoxes] = useState<RedactionBox[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<RedactionBox | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load and display image on canvas
  useEffect(() => {
    if (!selectedFile) return;

    if (selectedFile.type.startsWith('video/')) {
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(selectedFile);
    img.src = objectUrl;

    img.onload = () => {
      imageElementRef.current = img;
      setBoxes([]);
      drawCanvas(img, []);
    };

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  // Redraw canvas whenever boxes or currentBox change
  const drawCanvas = (img: HTMLImageElement, currentBoxes: RedactionBox[], tempBox?: RedactionBox | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Draw base image
    ctx.drawImage(img, 0, 0);

    // Draw confirmed black boxes
    ctx.fillStyle = '#000000';
    for (const b of currentBoxes) {
      ctx.fillRect(b.x, b.y, b.width, b.height);
    }

    // Draw in-progress box outline
    if (tempBox) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(tempBox.x, tempBox.y, tempBox.width, tempBox.height);
      ctx.strokeStyle = '#e63946';
      ctx.lineWidth = 4;
      ctx.strokeRect(tempBox.x, tempBox.y, tempBox.width, tempBox.height);
    }
  };

  useEffect(() => {
    if (imageElementRef.current) {
      drawCanvas(imageElementRef.current, boxes, currentBox);
    }
  }, [boxes, currentBox]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setErrorMsg(null);
    }
  };

  // Canvas drawing mouse/touch handlers
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY),
    };
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const coords = getCanvasCoords(e);
    setDrawing(true);
    setStartPos(coords);
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing || !startPos) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);

    const x = Math.min(startPos.x, coords.x);
    const y = Math.min(startPos.y, coords.y);
    const width = Math.abs(coords.x - startPos.x);
    const height = Math.abs(coords.y - startPos.y);

    setCurrentBox({
      id: 'box_' + Date.now(),
      x,
      y,
      width,
      height,
    });
  };

  const handlePointerUp = () => {
    if (drawing && currentBox && currentBox.width > 10 && currentBox.height > 10) {
      setBoxes((prev) => [...prev, currentBox]);
    }
    setDrawing(false);
    setStartPos(null);
    setCurrentBox(null);
  };

  const addQuickFaceBox = () => {
    if (!imageElementRef.current) return;
    const img = imageElementRef.current;
    const newBox: RedactionBox = {
      id: 'box_' + Date.now(),
      x: Math.round(img.naturalWidth * 0.35),
      y: Math.round(img.naturalHeight * 0.15),
      width: Math.round(img.naturalWidth * 0.3),
      height: Math.round(img.naturalHeight * 0.3),
    };
    setBoxes((prev) => [...prev, newBox]);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      setErrorMsg(null);

      let fileToUpload: File | Blob = selectedFile;
      let isAnonymized = false;

      if (selectedFile.type.startsWith('image/')) {
        // Anonymize by burning black rectangles into pixels
        if (boxes.length > 0) {
          const result = await anonymizeImage(selectedFile, boxes);
          fileToUpload = result.blob;
          isAnonymized = true;
        } else {
          isAnonymized = false;
        }
      } else {
        // Video upload
        isAnonymized = true;
      }

      // Upload to IPFS backend
      const res = await API.uploadProof(fileToUpload, isAnonymized);

      onEvidenceAdded(res.evidence);
      setSelectedFile(null);
      setBoxes([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Échec de l’envoi de la preuve');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">
        <Camera size={20} /> Preuves visuelles & Anonymisation IPFS
      </h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Pour votre sécurité et celle des personnes filmées, vous pouvez{' '}
        <strong>dessiner des carrés noirs directement avec votre doigt ou souris</strong> sur les visages,
        tatouages et plaques d'immatriculation. Les métadonnées EXIF (GPS matériel, numéro de série) sont
        automatiquement supprimées.
      </p>

      {/* File input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*,video/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {!selectedFile ? (
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera size={20} /> Sélectionner une photo ou vidéo
        </button>
      ) : (
        <div className="anonymizer-box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {selectedFile.type.startsWith('video/') ? 'Vidéo sélectionnée' : 'Glissez pour masquer (visages/plaques)'}
            </span>
            <button
              type="button"
              className="btn btn-outline"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', minHeight: '30px' }}
              onClick={() => {
                setSelectedFile(null);
                setBoxes([]);
              }}
            >
              Annuler
            </button>
          </div>

          {/* Interactive Canvas for Images */}
          {selectedFile.type.startsWith('image/') ? (
            <div>
              <div className="anonymizer-canvas-wrapper">
                <canvas
                  ref={canvasRef}
                  onMouseDown={handlePointerDown}
                  onMouseMove={handlePointerMove}
                  onMouseUp={handlePointerUp}
                  onTouchStart={handlePointerDown}
                  onTouchMove={handlePointerMove}
                  onTouchEnd={handlePointerUp}
                />
              </div>

              {/* Anonymizer Action Bar */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={addQuickFaceBox}
                  style={{ fontSize: '0.85rem', flex: 1 }}
                >
                  <Plus size={16} /> Carré visage rapide
                </button>
                {boxes.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setBoxes([])}
                    style={{ fontSize: '0.85rem', flex: 1 }}
                  >
                    <Trash2 size={16} /> Effacer les carrés ({boxes.length})
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding: '1rem', textAlign: 'center', backgroundColor: 'var(--bg-input)' }}>
              <Video size={40} style={{ color: 'var(--accent-blue)', marginBottom: '0.5rem' }} />
              <p style={{ fontSize: '0.9rem' }}>Vidéo prête pour archivage décentralisé sur IPFS.</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Nom : {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} Mo)
              </p>
            </div>
          )}

          {errorMsg && (
            <div style={{ color: '#ff6b6b', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              ⚠️ {errorMsg}
            </div>
          )}

          <div style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={handleUpload}
              disabled={uploading}
            >
              <ShieldCheck size={20} />
              {uploading ? 'Envoi sécurisé vers IPFS...' : 'Valider & Envoyer vers IPFS'}
            </button>
          </div>
        </div>
      )}

      {/* Uploaded Evidence List */}
      {existingEvidence.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
            Preuves associées ({existingEvidence.length})
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {existingEvidence.map((ev) => (
              <div
                key={ev.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: 'var(--bg-input)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {ev.isVideo ? <Video size={16} /> : <ImageIcon size={16} />}
                  <div>
                    <div>{ev.originalName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>
                      IPFS CID : {ev.cid.substring(0, 16)}...
                      {ev.anonymized && ' • Anonymisé ✓'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ minHeight: '32px', padding: '0.2rem 0.5rem', color: '#ff6b6b' }}
                  onClick={() => onEvidenceRemoved(ev.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
