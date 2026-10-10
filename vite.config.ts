import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Le menu ne charge que ~270 ko ; le moteur 3D et physique (three.js + Rapier, dont le WebAssembly est embarqué en base64,
    // ≈ 3,2 Mo, ≈ 1,1 Mo compressé) est chargé à la demande au lancement d'une partie (import dynamique de DrivingScene).
    // Un découpage manuel en fichiers de bibliothèques a été essayé : rolldown y regroupait three, React et Rapier ensemble
    // sans gain de cache ni de taille. Le seuil de l'avertissement tient compte de ce chunk volontairement lourd et paresseux.
    chunkSizeWarningLimit: 3_400,
  },
});
