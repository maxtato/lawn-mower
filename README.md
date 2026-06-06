# 🚜 Mow & Go

Petit jeu de tondeuse à gazon en **vue de dessus**, en HTML5 Canvas + JavaScript pur (aucune dépendance).

## But du jeu

Le décor est une **image de vrai jardin de pavillon** (`assets/garden.png`) :
maison 🏠, garage, allée pavée, terrasse, clôture, massifs et arbres. **Recouvre
toute la pelouse** : la tonte révèle une **herbe vert clair** derrière la
tondeuse… sans tout casser :

- 🌱 **Pelouse** → la tondeuse laisse une traînée vert clair (largeur de la lame) ; couvre toute l'herbe autour du décor
- 🏠 **Maison / garage / clôture / bac** → obstacles solides à contourner
- 🛣️ **Allée pavée / terrasse** → se traversent librement (rien à tondre)
- 🌸 **Massifs de fleurs** → ne roule **PAS** dessus (−30 pts)
- 🌳 **Arbres** / 🪨 **rochers** → obstacles solides : les percuter **vite** endommage la tondeuse (mais elle est robuste !)
- ❤️ La tondeuse a une **barre de vie** : à 0, c'est game over

> ℹ️ Dépose ton image dans `assets/garden.png` (voir `assets/README.md`). Sans
> elle, le jeu tourne avec un fond vert de repli et les obstacles repérés. La
> résolution interne s'adapte automatiquement à la taille de l'image.

À la fin, une **note sur 3 étoiles** récompense la rapidité et les fleurs épargnées.

## Contrôles

| Action       | Ordinateur                          | Mobile / iPhone                 |
|--------------|-------------------------------------|---------------------------------|
| Se déplacer  | `↑` `↓` `←` `→` ou `Z` `Q` `S` `D`   | 🕹️ Joystick dynamique (360°)     |
| Turbo        | `Maj`                               | Bouton ⚡ (en bas à droite)      |
| Recommencer  | `R`                                 | Bouton « Rejouer »              |

Sur appareil tactile, le **joystick apparaît là où tu poses le pouce**, n'importe
où sur l'aire de jeu : glisse dans n'importe quelle direction pour conduire la
tondeuse partout, à vitesse **proportionnelle à l'amplitude** (déplacement libre,
pas de grille). Le bouton **⚡ Turbo** accélère — mais attention aux chocs !

Le jeu **occupe tout l'écran** sur mobile, et un bouton **plein écran ⛶** est
disponible sur ordinateur / Android / iPad.

## En ligne

Déployé sur Vercel : **https://lawn-mower.vercel.app**

## Lancer le jeu

Ouvre simplement `index.html` dans un navigateur.
Ou sers le dossier localement :

```bash
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

## Fichiers

- `index.html` — structure + HUD
- `style.css` — habillage
- `game.js` — logique du jeu (grille, tondeuse, collisions, score)

## Idées pour la suite

- Plusieurs niveaux aux formes variées
- Jauge de carburant / batterie
- Bonus (boost, bidon d'essence)
- Sons et musique
- Sauvegarde des meilleurs scores
