# TWIZA — pipeline satellite (Souk Lahad, Kébili)

Repère les terres irriguées autour de Souk Lahad sur une image Sentinel-2 réelle
et estime la consommation d'eau. C'est un **indicateur indirect** des prélèvements :
une tête de forage est invisible à 10 m, on observe ce qu'elle arrose.

**Règle de confidentialité** : rien de public ne désigne une parcelle comme « non
recensée ». Le prélèvement non recensé n'est publié qu'agrégé sur une grille
d'hexagones H3 (résolution 8, ~0,74 km²). Le drapeau par parcelle reste dans
`satellite/out/` (ignoré par git, jamais servi).

## Méthode

1. **Scène** : recherche STAC (Element84 Earth Search, `sentinel-2-l2a`) sur la bbox
   `[8.8076, 33.7433, 8.8976, 33.8133]`, été 2026 (repli été 2025), nuages < 10 %,
   scène la moins nuageuse couvrant toute la bbox. Lecture fenêtrée des COG B04 (rouge),
   B08 (PIR) à 10 m et B11 (SWIR, 20 m rééchantillonné à 10 m). Cache dans `cache/`.
2. **Indices** : NDVI = (PIR − R)/(PIR + R), NDMI = (PIR − SWIR)/(PIR + SWIR).
   En saison sèche, dans le désert, NDVI élevé = végétation irriguée.
3. **Seuil NDVI = 0,30**. L'histogramme de la scène du 6 juillet 2026 a un pic désert
   très net (65 % des pixels entre 0,00 et 0,10) puis un plateau de 0,15 à 0,70 ; le
   seuil d'Otsu calculé sur la scène vaut 0,299. Entre 0,15 et 0,30 on trouve surtout
   des pixels mixtes (lisières, palmiers épars, jeunes plantations) : on les exclut.
4. **Nettoyage** : ouverture puis fermeture morphologiques 3×3 (croix) — on ne ferme
   que les trous d'un pixel pour ne pas souder les parcelles —, suppression des
   composantes < 0,2 ha.
5. **Découpage** : le seuillage seul donne une tache de 768 ha qui avale la palmeraie.
   Elle est découpée par ligne de partage des eaux sur le NDVI lissé (graines = maxima
   locaux, frontières = creux de NDVI : pistes, drains, bandes clairsemées). Résultat :
   des blocs de palmeraie de 3 ha en médiane (`--no-split` pour désactiver).
   Ce ne sont **pas** des parcelles cadastrales.
6. **Eau** : `surface_ha × 10 × Kc × ET0 ÷ efficience` (m³/jour), Kc palmier dattier
   0,95, efficience 0,6, ET0 = moyenne de juillet de `data/weather.json` (Open-Meteo).
7. **Registre** : une zone est « probablement non recensée » si aucun puits de
   `data/wells_registry.csv` n'est à moins de 400 m de son contour. Chaque pixel
   irrigué de 10 m est affecté à son hexagone H3 ; on somme par hexagone.
8. **Site pilote** : fenêtre glissante 1,1 km × 0,9 km, score = fraction irriguée
   − 0,04 par km de distance au centre-ville, centre à plus de 600 m du centre.

## Lancer

```bash
cd satellite
uv venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python pipeline.py                  # scène réelle (réseau, ~15 s)
.venv/bin/python pipeline.py --skip-download  # réutilise cache/ (hors ligne, ~2 s)
.venv/bin/python pipeline.py --synthetic --out /tmp/sat --private-out /tmp/sat_priv
```

Options : `--out <dir>` (défaut `app/public/data/`), `--private-out <dir>` (défaut
`satellite/out/`), `--threshold 0.30`, `--no-split`, `--hex-min-patches N` (met à
`null` les champs `unrecorded_*` des hexagones contenant moins de N zones).

Si le téléchargement échoue : la scène en cache est réutilisée ; sans cache, repli
automatique sur des zones synthétiques (graine fixe, autour de `data/plots.geojson`
s'il existe), mêmes fichiers, `source: "synthetic-fallback"` dans `sat_meta.json`.

Relancer avec `--skip-download` après toute modification du registre.

## Sorties

Publiques (`app/public/data/`) :
- `sat_patches.geojson` — polygones, `id`, `area_ha`, `ndvi_mean`, `est_m3_day`
  (aucune information recensé / non recensé).
- `sat_hex.geojson` — hexagones H3 rés. 8 : `h3`, `irrigated_ha`, `est_m3_day`,
  `unrecorded_ha`, `unrecorded_m3_day`.
- `ndvi.png` — RGBA, plate carrée sur la bbox exacte (coins = bbox), transparent sous
  le seuil.
- `sat_meta.json` — scène, paramètres, totaux.

Privées (`satellite/out/`) : `patches_private.geojson` (drapeau `likely_unrecorded`,
distance au puits recensé le plus proche), `site_suggestion.json`.

## Limites (à dire honnêtement)

- **NDVI ≠ puits.** On voit de la végétation active, pas des forages ni des débits.
  Une zone peut être arrosée par un forage collectif lointain via le réseau.
- **Pixels de 10 m**, mixtes en lisière ; chaque pixel retenu compte pour 100 m²
  de palmeraie à plein couvert, ce qui surestime les zones clairsemées.
- **Végétation naturelle** (roseaux de drains, tamaris, zones humides près du chott)
  et cultures sous palmiers sont comptées comme irriguées.
- **Une seule date** (6 juillet 2026) ; pas de masque nuage au pixel (scène à 0,66 %).
- **Kc (0,95) et efficience (0,6) supposés**, identiques partout ; ET0 = moyenne de
  juillet : le chiffre est une demande de pointe estivale, pas une moyenne annuelle.
- **Le registre est synthétique** et ne couvre que la communauté pilote, alors que
  l'image couvre toute l'oasis réelle : la part « non recensée » (94 %) est un artefact
  de cette différence d'étendue, pas un résultat.
- **Rayon de 400 m arbitraire** ; le découpage des zones est une segmentation d'image.
- **Hexagones H3 = dispositif de confidentialité**, imparfait : un hexagone qui ne
  contient qu'une zone, ou dont tout est « non recensé », renseigne indirectement sur
  les zones qu'il contient (`--hex-min-patches` traite le premier cas).
- Les COG Earth Search ont déjà le décalage radiométrique retiré
  (`earthsearch:boa_offset_applied`) bien que `raster:bands` annonce encore −0,1 :
  le script n'applique pas ce décalage une seconde fois.
- Segmentation par samgeo (SAM) : piste future, **non implémentée**.
