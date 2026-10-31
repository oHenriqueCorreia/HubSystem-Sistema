# Hub System — identidade visual

Versão 1.0 · 31 de outubro de 2026

## Conceito
O núcleo representa o sistema central; os seis braços representam conexão, integração e distribuição de informações. A composição horizontal une o símbolo ao nome Hub System. O símbolo isolado identifica o produto em espaços compactos.

## Paleta de referência
| Cor | HEX | RGB | Aplicação |
|---|---|---|---|
| Azul | #0969DA | 9, 105, 218 | Destaque e conexões |
| Marinho | #0B2245 | 11, 34, 69 | Marca e textos fortes |
| Ardósia | #526174 | 82, 97, 116 | Texto secundário |
| Branco | #FFFFFF | 255, 255, 255 | Marca sobre fundos escuros |

Estes valores orientam a interface. A versão principal preserva a imagem gerada, que pode apresentar variações sutis de tonalidade; as versões monocromáticas usam os valores acima.

## Versões
- **principal:** logo colorida para fundo branco ou muito claro.
- **branca:** todos os elementos brancos, para fundos escuros.
- **marinho:** monocromática para fundos claros e documentos.
- **azul:** monocromática para fundos claros.
- **tema-escuro:** conexões azuis e demais elementos brancos; aplicar sobre marinho ou preto.

Todos os PNGs exportados têm transparência real. A versão branca pode parecer vazia em visualizadores com fundo branco.

## Arquivos e tamanhos
**01-Logo-PNG:** larguras de 240, 320, 480, 640, 960 e 1600 pixels, com altura proporcional. Para cabeçalho com 160 pixels de largura, usar 320w; para 240 pixels, usar 480w. Esses pares atendem telas de densidade 2×.

**02-Simbolo-PNG:** 32, 48, 64, 128, 192, 256 e 512 pixels. Canvas quadrado transparente com margem interna aproximada de 8%. Usar em menu recolhido, avatar e ícone do produto.

**03-Favicon:** PNGs em 16, 32, 48, 64, 180, 192 e 512 pixels; ICO com 16/32/48; apple-touch-icon em 180 pixels. A versão de 16 pixels é destinada à aba do navegador e perde detalhes internos pela escala; preferir 32 ou 48 quando possível.

**05-Original:** conceito inicial e matriz transparente gerada, para referência e novas exportações.

## Regras de uso
Reservar espaço livre equivalente a pelo menos um círculo externo do símbolo ao redor da marca. O arquivo horizontal é recortado próximo ao desenho: adicionar essa área de proteção no layout.

Usar a marca horizontal a partir de 160 pixels de largura na interface. Abaixo disso, preferir o símbolo. Para o símbolo em controles, preferir 24 pixels ou mais; 16 pixels fica reservado ao favicon.

Preservar a proporção. Não esticar, inclinar, girar, adicionar sombras, contornos ou efeitos. Não trocar a posição dos elementos. Não aplicar a versão escura em fundo escuro nem a branca em fundo claro. Sobre fotografias, usar um painel de cor uniforme.

## Tipografia da interface
A escrita da logo é parte da imagem gerada e não corresponde a uma fonte certificada. Não reconstruir o nome digitando por cima. Para o sistema, a recomendação é Segoe UI com alternativas system-ui e sans-serif; títulos em peso 600 ou 700 e corpo em 400. A fonte não está incluída no pacote.

## Integração
Consultar integracao.html para exemplos de cabeçalho, menu compacto e fundo escuro. Copiar as pastas de imagens para os arquivos públicos do sistema e ajustar os caminhos conforme o projeto. O favicon não exige que a logo completa seja usada na aba.

Para instalação como aplicativo web, o manifesto incluído é um ponto de partida. Ajustar nome, caminho inicial e cores ao ambiente real; o pacote não implementa funcionamento offline. O ícone fornecido usa finalidade any; não é uma versão maskable.

## Formato e limites
Pacote raster para uso digital, exportado em PNG com transparência e ICO para navegador. Não contém matriz vetorial SVG/AI, nem fonte editável da escrita. As exportações derivam da matriz transparente gerada por IA e não constituem uma vetorização técnica. Para grandes impressões, produzir e revisar uma matriz vetorial antes da produção.

## Produção
Ferramenta: geração de imagens integrada para transparência; exportação determinística para escalas, recortes e cores. Instrução aplicada: preservar símbolo, letras, arranjo e proporções da logo Hub System; remover fundo branco, incluindo espaços internos; preparar transparência e cores de referência, sem adicionar elementos.
