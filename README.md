# 🚜 Mow & Go

Petit jeu de tondeuse à gazon en **vue de dessus**, en HTML5 Canvas + JavaScript pur (aucune dépendance).

## But du jeu

Tonds **100 % du gazon** d'un jardin… sans tout casser :

- 🌱 **Herbe haute** → passe dessus pour la tondre (+10 pts)
- 🌸 **Massifs de fleurs** → ne roule **PAS** dessus (−30 pts, fleurs détruites)
- 🌳 **Arbres** / 🪨 **rochers** → obstacles solides : les percuter vite **endommage** la tondeuse
- ❤️ La tondeuse a une **barre de vie** : à 0, c'est game over

À la fin, une **note sur 3 étoiles** récompense la rapidité et les fleurs épargnées.

## Contrôles

| Action       | Touches                          |
|--------------|----------------------------------|
| Se déplacer  | `↑` `↓` `←` `→` ou `Z` `Q` `S` `D` |
| Recommencer  | `R`                              |

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
