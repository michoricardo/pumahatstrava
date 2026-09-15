(async () => {
  const stravaId = prompt("Introduce el ID de Strava del atleta (por ejemplo: 1332#######):");
  if (!stravaId || isNaN(stravaId)) {
    console.error("ID inválido. Asegúrate de ingresar un número.");
    return;
  }

  const tipos = ['following', 'followers'];
  const nombresPorTipo = {
    following: [],
    followers: []
  };

  for (const tipo of tipos) {
    let page = 1;
    let hayMas = true;

    while (hayMas) {
      const url = `https://www.strava.com/athletes/${stravaId}/follows?page=${page}&page_uses_modern_javascript=true&type=${tipo}`;
      console.log(`Cargando ${tipo}, página ${page}...`);

      try {
        const response = await fetch(url, {
          credentials: 'include'
        });
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const nombres = Array.from(doc.querySelectorAll('.text-callout a'))
          .map(el => el.textContent.trim())
          .filter(text => text.length > 0);

        if (nombres.length === 0) {
          hayMas = false;
          console.log(`No se encontraron más nombres en ${tipo}.`);
        } else {
          nombresPorTipo[tipo].push(...nombres);
          page++;
        }
      } catch (error) {
        console.error(`Error al cargar ${tipo}, página ${page}:`, error);
        hayMas = false;
      }
    }
  }

  const setFollowing = new Set(nombresPorTipo.following);
  const setFollowers = new Set(nombresPorTipo.followers);

  const noMeSiguen = [...setFollowing].filter(nombre => !setFollowers.has(nombre));
  const noSigo = [...setFollowers].filter(nombre => !setFollowing.has(nombre));

  console.log('--- SEGUIDOS ---\n' + nombresPorTipo.following.join('\n'));
  console.log('\n--- SEGUIDORES ---\n' + nombresPorTipo.followers.join('\n'));
  console.log('\n--- LOS SIGUES PERO NO TE SIGUEN ---\n' + noMeSiguen.join('\n'));
  console.log('\n--- TE SIGUEN PERO NO LOS SIGUES ---\n' + noSigo.join('\n'));
})();