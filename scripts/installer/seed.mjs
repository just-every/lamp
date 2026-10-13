import * as presentation from './ui/seed.mjs';
import { install } from './install.mjs';
export function createSeed() {
 return {product:presentation.product.name,branding:presentation.branding,setup:{manifestFile:'rer-setup.json'},browserModule:'scripts/installer/ui/seed.mjs',background:'scripts/installer/ui/background.svg',theme:'public/rer-theme.css',features:presentation.features,defaults:()=>({addressMode:'custom'}),install};
}
