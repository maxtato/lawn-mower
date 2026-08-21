# 🚜 Mow & Go — Brief de conception (à partager pour inspiration)

> Document autonome décrivant le jeu **Mow & Go** : concept, mécaniques, rendu
> et architecture. Peut être lu par un humain ou **collé dans une conversation
> avec un assistant IA** pour s'inspirer de ce projet.
>
> Code source (public) : https://github.com/maxtato/lawn-mower
> Démo en ligne : https://lawn-mower.vercel.app

---

## 1. Pitch

Jeu **arcade en vue de dessus**. On pilote une **tondeuse à gazon** dans le
jardin d'un pavillon. Objectif : **tondre 100 % de la pelouse** — la tondeuse
laisse une **traînée vert clair** derrière elle — **sans abîmer** les massifs de
fleurs ni **percuter** les obstacles (maison, arbres, mare, objets qui traînent).

Zéro dépendance : **HTML5 Canvas + JavaScript pur**, jouable au clavier et au
tactile, déployable en statique.

## 2. Boucle de jeu

1. La pelouse commence entièrement « à tondre » (herbe haute foncée).
2. En roulant, la tondeuse **peint une bande tondue** (vert clair texturé).
3. Il faut **couvrir toute la pelouse** (victoire ≈ 97 % pour tolérer les
   recoins inatteignables).
4. **Malus** si on roule sur un massif de fleurs / le potager.
5. **Dégâts** (barre de vie) si on percute vite un obstacle solide ; à 0 → panne.
6. Écran de fin avec **note 1–3 étoiles** (rapidité + fleurs épargnées).

## 3. Contrôles

| Action      | Clavier                    | Tactile / mobile              |
|-------------|----------------------------|-------------------------------|
| Se déplacer | flèches ou `Z Q S D`       | **joystick dynamique** (360°) |
| Turbo       | `Maj`                      | bouton ⚡                      |
| Recommencer | `R`                        | bouton « Rejouer »            |

- Déplacement **analogique** : direction libre 360°, vitesse proportionnelle à
  la poussée du joystick.
- Joystick **dynamique** : il apparaît sous le pouce, n'importe où.
- Plein écran mobile + mise à l'échelle (`fitCanvas`), viewport iOS adapté.

## 4. Caméra & monde

- **Monde plus grand que l'écran** (≈ 1800×1350) ; on n'en voit qu'un bout.
- **Zoom** (×2) et **caméra qui suit la tondeuse** : le jardin **défile** quand
  on approche d'un bord, et se **cale** aux limites du monde.
- Rendu : on **blitte** seulement la portion visible du monde (efficace).

## 5. Éléments du jardin

- **Pelouse** (fond continu, texturé) — la seule surface à tondre.
- **Maison + garage** : dessinés en **vrais toits vus de dessus** (croupe :
  4 pans ombrés + faîtage + cheminée), pas de façade à plat.
- **Arbres variés** vus de dessus (couronne ronde, sans tronc qui « descend ») :
  chêne, pin (aiguilles radiales), bouleau, arbre rond.
- **Buissons** aux **couleurs contrastées** avec la pelouse (vert teal foncé).
- **Massifs de fleurs** multicolores, **potager** (rangs + légumes).
- **Mare** avec nénuphars, **terrasse** + table, **allée pavée**, **pas
  japonais**, **haie**, **banc**, **pots**, **rochers**, **vasque à oiseaux**.
- **Objets à éviter** : ballons de foot, râteaux, arrosoir, seau, brouette,
  nain de jardin.
- **Clôture** sur tout le pourtour (limite du monde).
- Détails de vie : pâquerettes, pissenlits, trèfles disséminés dans l'herbe
  (recouverts par la tonte → bon rendu « avant/après »).

## 6. Direction artistique

- Style **illustratif « tile-game »**, top-down assumé.
- Palette pelouse verte moyenne ; obstacles/arbres **plus sombres** pour
  trancher ; tonte en **vert clair** avec petits brins visibles.
- Ombres portées légères sous chaque élément pour le relief.

## 7. Architecture technique (idées réutilisables)

- **3 calques hors-écran à la taille du monde** :
  1. `grass` — pelouse non tondue (statique, pré-rendue).
  2. `mow` — **traînée tondue** (disques peints le long du trajet, motif vert
     clair répété → texture d'herbe tondue).
  3. `decor` — tous les éléments (statique, pré-rendu) dessiné **par-dessus** la
     traînée (donc les arbres/massifs masquent la tonte : pas besoin de la
     découper).
- **Traînée continue** : entre l'ancienne et la nouvelle position, on
  interpole une suite de disques (pas de trous à grande vitesse).
- **Grille de couverture** fine (cellules ~10 px) : chaque disque marque les
  cellules « pelouse » comme tondues → calcul du **% couvert** sans lire les
  pixels.
- **Collisions par formes** (rectangles, cercles, ellipses) : `solids`
  (bloquent + dégâts), `paved` (carrossable, non tondable), `beds` (non
  tondable + malus). Test cercle-vs-forme pour la tondeuse.
- **Halo de coupe (`DECK`) un peu plus large que le rayon de collision** : on
  tond **au ras** des obstacles/massifs sans que la tondeuse elle-même y entre.

## 8. Paramètres faciles à régler (dans `game.js`)

| Constante            | Rôle                                             |
|----------------------|--------------------------------------------------|
| `WORLD_W`, `WORLD_H` | taille du monde                                  |
| `ZOOM`               | niveau de zoom de la caméra                      |
| `DECK`               | largeur du halo de tonte                         |
| `makeMower().maxSpeed` | vitesse de la tondeuse                          |
| `CELL`               | finesse de la grille de couverture               |
| seuil de victoire    | `mowedCount >= mowableTotal * 0.97`              |

## 9. À « voler » pour un autre jeu

- La technique **grass / mow / decor** en 3 calques + **grille de couverture**
  marche pour tout jeu de « peinture de zone » (déneigement, peinture, nettoyage…).
- La **caméra qui suit + zoom + blit de la portion visible** est un patron de
  scrolling top-down réutilisable tel quel.
- Le **joystick dynamique analogique** + turbo est un module de contrôle mobile
  autonome.
- Le rendu **top-down cohérent** (toits en croupe, arbres en couronne, ombres
  portées) donne une recette de style « vu du ciel » lisible.
