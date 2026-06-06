# Image de fond du jardin

Place ici le fichier **`garden.png`** (l'illustration du jardin en vue de dessus).

Le jeu charge automatiquement `assets/garden.png` comme fond et adapte sa
résolution interne à la taille native de l'image. Tant que le fichier est
absent, le jeu affiche un fond vert de repli avec les obstacles repérés.

## Comment l'ajouter

- Glisse `garden.png` dans ce dossier puis commit/push, **ou**
- donne-moi une URL publique de l'image et je l'intègre.

Les zones d'obstacles (maison, garage, allée, terrasse, arbres, bac, rochers,
massifs) sont définies en proportions de l'image dans `game.js`
(`buildGeometry`), donc elles s'ajustent à n'importe quelle résolution tant
que le cadrage reste le même que l'illustration fournie.
