const express = require('express');
const { requireAuth } = require('./auth');
const { loadValidatedDefinitions, getValidatedDefinition } = require('../tableros');
const odooClient = require('../odoo-client');
const { PERIODOS } = require('../agregaciones');
const { obtenerDatosVentasMensuales } = require('../ventas-mensual');
const { obtenerDatosCompras } = require('../compras-mensual');
const { datosTopbar } = require('../topbar');

const router = express.Router();

router.get('/tableros', requireAuth, async (req, res) => {
  try {
    const definiciones = await loadValidatedDefinitions();
    const primero = definiciones.find((d) => d.valido);
    if (!primero) {
      return res.status(500).render('error', { mensaje: 'No hay tableros válidos configurados.' });
    }
    res.redirect(`/tableros/${primero._id}`);
  } catch (err) {
    res.status(500).render('error', { mensaje: `Error al cargar tableros: ${err.message || err}` });
  }
});

router.get('/tableros/:id', requireAuth, async (req, res) => {
  try {
    const def = await getValidatedDefinition(req.params.id);
    if (!def) return res.status(404).render('error', { mensaje: 'Tablero no encontrado.' });
    if (!def.valido) {
      return res.status(422).render('error', {
        mensaje: `Este tablero no pasó la evaluación semántica y no puede mostrarse:\n${def.errores.join('\n')}`,
      });
    }

    const topbar = await datosTopbar(req.session.usuario, def._id);

    if (def.tipo === 'ventas_mensual') {
      const periodo = req.query.periodo || 'este_mes';
      const empresaId = req.query.empresa ? Number(req.query.empresa) : null;
      const vendedorId = req.query.vendedor ? Number(req.query.vendedor) : null;
      const datos = await obtenerDatosVentasMensuales({ periodo, empresaId, vendedorId });

      const filasFormateadas = datos.filas.map((fila) => ({
        name: fila.name,
        partner_id: fila.partner_id ? fila.partner_id[1] : '',
        user_id: fila.user_id ? fila.user_id[1] : '',
        date_order: fila.date_order,
        amount_total: fila.amount_total,
        state: fila.state,
      }));

      const total = datos.filas.reduce((acc, f) => acc + (f.amount_total || 0), 0);
      const mejorVendedor = datos.graficoVendedores.entradas[0];
      const kpis = {
        total,
        cantidad: datos.filas.length,
        ticketPromedio: datos.filas.length ? total / datos.filas.length : 0,
        mejorVendedor: mejorVendedor ? { nombre: mejorVendedor[0], valor: mejorVendedor[1] } : null,
      };

      return res.render('ventas-mensual', {
        ...topbar,
        def,
        periodos: PERIODOS,
        filtros: { periodo, empresaId, vendedorId },
        empresas: datos.empresas,
        vendedores: datos.vendedores,
        graficoClientes: datos.graficoClientes,
        graficoVendedores: datos.graficoVendedores,
        graficoProductos: datos.graficoProductos,
        filas: filasFormateadas,
        kpis,
      });
    }

    if (def.tipo === 'compras_mensual') {
      const periodo = req.query.periodo || 'este_mes';
      const empresaId = req.query.empresa ? Number(req.query.empresa) : null;
      const proveedorId = req.query.proveedor ? Number(req.query.proveedor) : null;
      const datos = await obtenerDatosCompras({ periodo, empresaId, proveedorId });

      const filasFormateadas = datos.filas.map((fila) => ({
        name: fila.name,
        partner_id: fila.partner_id ? fila.partner_id[1] : '',
        date_order: fila.date_order,
        amount_total: fila.amount_total,
        state: fila.state,
      }));

      const total = datos.filas.reduce((acc, f) => acc + (f.amount_total || 0), 0);
      const mejorProveedor = datos.graficoProveedores.entradas[0];
      const kpis = {
        total,
        cantidad: datos.filas.length,
        ticketPromedio: datos.filas.length ? total / datos.filas.length : 0,
        mejorProveedor: mejorProveedor ? { nombre: mejorProveedor[0], valor: mejorProveedor[1] } : null,
      };

      return res.render('compras-mensual', {
        ...topbar,
        def,
        periodos: PERIODOS,
        filtros: { periodo, empresaId, proveedorId },
        empresas: datos.empresas,
        proveedores: datos.proveedores,
        graficoProveedores: datos.graficoProveedores,
        graficoProductos: datos.graficoProductos,
        filas: filasFormateadas,
        kpis,
      });
    }

    const campos = def.campos.map((c) => (typeof c === 'string' ? c : c.campo));
    const camposConsulta = new Set(campos);
    if (def.grafico) {
      camposConsulta.add(def.grafico.agrupar_por);
      camposConsulta.add(def.grafico.medir);
    }
    const filas = await odooClient.executeKw(def.modelo, 'search_read', [def.dominio || []], {
      fields: [...camposConsulta],
      limit: def.limite || 80,
      order: def.orden || '',
    });

    let grafico = null;
    if (def.grafico) {
      const totales = new Map();
      for (const fila of filas) {
        const bruto = fila[def.grafico.agrupar_por];
        const etiqueta = Array.isArray(bruto) ? bruto[1] : bruto === false ? 'Sin dato' : String(bruto);
        const valor = Number(fila[def.grafico.medir]) || 0;
        totales.set(etiqueta, (totales.get(etiqueta) || 0) + valor);
      }
      const entradas = [...totales.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      const max = Math.max(...entradas.map(([, valor]) => valor), 1);
      grafico = { titulo: def.grafico.titulo || `${def.grafico.medir} por ${def.grafico.agrupar_por}`, entradas, max };
    }

    const columnas = def.campos.map((c) =>
      typeof c === 'string' ? { campo: c, etiqueta: c } : { campo: c.campo, etiqueta: c.etiqueta || c.campo }
    );

    const filasFormateadas = filas.map((fila) => {
      const formateada = {};
      for (const { campo } of columnas) {
        const valor = fila[campo];
        if (Array.isArray(valor) && valor.length === 2) {
          formateada[campo] = valor[1];
        } else if (valor === false) {
          formateada[campo] = '';
        } else {
          formateada[campo] = valor;
        }
      }
      return formateada;
    });

    res.render('tablero-detalle', { ...topbar, def, columnas, filas: filasFormateadas, grafico, totalRegistros: filas.length });
  } catch (err) {
    res.status(500).render('error', { mensaje: `Error al ejecutar el tablero: ${err.message || err}` });
  }
});

module.exports = router;
